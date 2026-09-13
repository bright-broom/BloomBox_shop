import { anonymousPurchaseCustomer, type CurrentPurchaseCustomer } from "./current-purchase-customer";
import { assertPurchaseCustomer, purchaseCustomer } from "../domain/purchase-customer";
import type { CheckoutSession, CheckoutSessionProvider } from "./checkout-session-provider";
import { purchaseIntentId, type PurchaseIntentId } from "../domain/purchase-intent";
import type { PurchaseIntentRepository } from "../domain/purchase-intent-repository";
import { CheckoutPausedError } from "./checkout-paused-error";

export const MINIMUM_CHECKOUT_WINDOW_MINUTES = 30;

export class PurchaseIntentNotFoundError extends Error {
  constructor() {
    super("購入準備が見つかりませんでした。ページを更新してもう一度お試しください。");
    this.name = "PurchaseIntentNotFoundError";
  }
}

export class PurchaseIntentNotReadyError extends Error {
  constructor() {
    super("この購入準備から決済を開始することはできません。");
    this.name = "PurchaseIntentNotReadyError";
  }
}

export class CheckoutWindowExpiredError extends Error {
  constructor() {
    super("購入準備の有効期限が近いため、ページを更新してもう一度お試しください。");
    this.name = "CheckoutWindowExpiredError";
  }
}

export class CheckoutProviderMismatchError extends Error {
  constructor() {
    super("Checkout provider returned an inconsistent reference");
    this.name = "CheckoutProviderMismatchError";
  }
}

export class StartCheckout {
  constructor(
    private readonly intents: PurchaseIntentRepository,
    private readonly provider: CheckoutSessionProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly acceptsNewCheckout: () => boolean = () => true,
    private readonly currentCustomer: CurrentPurchaseCustomer = anonymousPurchaseCustomer,
  ) {}

  async execute(rawId: string): Promise<CheckoutSession> {
    if (!this.acceptsNewCheckout()) throw new CheckoutPausedError();
    if (this.provider.provider !== "STRIPE") throw new CheckoutProviderMismatchError();
    const id = purchaseIntentId(rawId);
    const intent = await this.intents.findById(id);
    if (!intent) throw new PurchaseIntentNotFoundError();
    assertPurchaseCustomer(intent.customer, purchaseCustomer(await this.currentCustomer()));
    if (intent.commerceProvider && intent.commerceProvider !== this.provider.provider) throw new CheckoutProviderMismatchError();

    if (
      intent.status === "CHECKOUT_CREATED"
      && intent.commerceProvider === this.provider.provider
      && intent.externalCheckoutId
    ) {
      const existing = await this.provider.retrieve(intent.externalCheckoutId);
      assertConsistentSession(existing, id, this.provider.provider);
      return existing;
    }

    if (intent.status !== "READY_FOR_CHECKOUT") throw new PurchaseIntentNotReadyError();
    const occurredAt = this.now();
    const minimumExpiry = occurredAt.getTime() + MINIMUM_CHECKOUT_WINDOW_MINUTES * 60 * 1000;
    if (intent.expiresAt.getTime() < minimumExpiry) throw new CheckoutWindowExpiredError();

    if (!this.acceptsNewCheckout()) throw new CheckoutPausedError();
    await this.intents.claimCommerceProvider(id, this.provider.provider);
    if (!this.acceptsNewCheckout()) throw new CheckoutPausedError();
    assertPurchaseCustomer(intent.customer, purchaseCustomer(await this.currentCustomer()));
    const checkoutSession = await this.provider.create(
      intent,
      `purchase-intent:${intent.id}:checkout:v1`,
    );
    assertConsistentSession(checkoutSession, id, this.provider.provider);
    if (checkoutSession.expiresAt > intent.expiresAt) throw new CheckoutProviderMismatchError();

    intent.recordCheckoutCreated({
      provider: checkoutSession.provider,
      externalCheckoutId: checkoutSession.id,
      providerApiVersion: checkoutSession.apiVersion,
      occurredAt,
    });
    await this.intents.saveCheckoutCreated(intent);
    return checkoutSession;
  }
}

function assertConsistentSession(
  session: CheckoutSession,
  intentId: PurchaseIntentId,
  provider: CheckoutSessionProvider["provider"],
): void {
  if (
    session.provider !== provider
    || session.purchaseIntentId !== intentId
    || !session.id
    || !session.url
  ) {
    throw new CheckoutProviderMismatchError();
  }
  try {
    if (new URL(session.url).protocol !== "https:") throw new CheckoutProviderMismatchError();
  } catch (error) {
    if (error instanceof CheckoutProviderMismatchError) throw error;
    throw new CheckoutProviderMismatchError();
  }
}
