import type { CommerceProvider, PurchaseIntent, PurchaseIntentId } from "../domain/purchase-intent";
import { purchaseIntentId } from "../domain/purchase-intent";
import { assertPurchaseCustomer, purchaseCustomer } from "../domain/purchase-customer";
import { anonymousPurchaseCustomer, type CurrentPurchaseCustomer } from "./current-purchase-customer";
import { PurchaseIntentNotFoundError } from "./start-checkout";

export class PurchaseCancellationUnavailableError extends Error {
  constructor() { super("決済手続きが始まっているため、この購入準備を取り消せません。"); this.name = "PurchaseCancellationUnavailableError"; }
}
/** The provider did not confirm that the hosted checkout is closed. Retrying is safe. */
export class PurchaseCancellationUnconfirmedError extends Error {
  constructor(options?: ErrorOptions) { super("購入手続きの取消を確認できませんでした。カートは残しています。時間をおいてもう一度お試しください。", options); this.name = "PurchaseCancellationUnconfirmedError"; }
}
export interface PurchaseCancellationRepository {
  findById(id: PurchaseIntentId): Promise<PurchaseIntent | null>;
  cancelBeforeCheckout(id: PurchaseIntentId): Promise<void>;
}
/**
 * Closes an issued hosted checkout so that it can no longer be paid.
 * EXPIRED only when the provider confirms the expiry; COMPLETED when the customer already finished
 * that checkout. Any other outcome throws. It never releases inventory: the verified provider
 * expiry event stays authoritative (ADR 0010).
 */
export interface CheckoutSessionCanceller {
  readonly provider: CommerceProvider;
  expire(externalCheckoutId: string, purchaseIntentId: PurchaseIntentId): Promise<"EXPIRED" | "COMPLETED">;
}
/**
 * RELEASED: cancelled before provider selection; the reservation was released in the same transaction.
 * EXPIRY_CONFIRMED: the provider closed the hosted checkout; release follows its verified expiry event.
 * ALREADY_CLOSED: an earlier cancellation, expiry, or payment failure already ended the purchase.
 * CHECKOUT_COMPLETED: the customer already finished checkout; nothing is cancelled and payment facts stay intact.
 */
export type PurchaseCancellation = "RELEASED" | "EXPIRY_CONFIRMED" | "ALREADY_CLOSED" | "CHECKOUT_COMPLETED";

export class CancelPurchaseIntent {
  constructor(
    private readonly intents: PurchaseCancellationRepository,
    private readonly currentCustomer: CurrentPurchaseCustomer = anonymousPurchaseCustomer,
    private readonly checkoutSessions?: CheckoutSessionCanceller,
  ) {}

  async execute(rawId: string): Promise<PurchaseCancellation> {
    const id = purchaseIntentId(rawId);
    const intent = await this.intents.findById(id);
    if (!intent) throw new PurchaseIntentNotFoundError();
    assertPurchaseCustomer(intent.customer, purchaseCustomer(await this.currentCustomer()));
    if (intent.status === "ABANDONED" || intent.status === "EXPIRED") return "ALREADY_CLOSED";
    if (intent.status === "CONVERTED") return "CHECKOUT_COMPLETED";
    if (intent.status === "CHECKOUT_CREATED") {
      const externalCheckoutId = intent.externalCheckoutId;
      if (!externalCheckoutId || !this.checkoutSessions || intent.commerceProvider !== this.checkoutSessions.provider) {
        throw new PurchaseCancellationUnavailableError();
      }
      const closed = await this.checkoutSessions.expire(externalCheckoutId, id);
      return closed === "COMPLETED" ? "CHECKOUT_COMPLETED" : "EXPIRY_CONFIRMED";
    }
    // The repository re-checks status and provider selection under a row lock.
    await this.intents.cancelBeforeCheckout(id);
    return "RELEASED";
  }
}
