import { purchaseIntentId } from "../domain/purchase-intent";
import type { PurchaseIntentRepository } from "../domain/purchase-intent-repository";
import { CheckoutPausedError } from "./checkout-paused-error";
import { PurchaseIntentNotFoundError, PurchaseIntentNotReadyError } from "./start-checkout";
import {
  ShopifyCheckoutConflictError, ShopifyCheckoutUncertainError,
  type ShopifyCartProvider, type ShopifyCheckoutAttempts,
} from "./shopify-checkout-attempt";

export const SHOPIFY_STALE_ATTEMPT_MS = 120_000;

/** Internal workflow only. Not composed into routes until ownership and verified order processing exist. */
export class StartShopifyCheckout {
  constructor(
    private readonly intents: PurchaseIntentRepository,
    private readonly attempts: ShopifyCheckoutAttempts,
    private readonly carts: ShopifyCartProvider,
    private readonly createId: () => string,
    private readonly now: () => Date = () => new Date(),
    private readonly acceptsNewCheckout: () => boolean = () => false,
  ) {}

  async execute(rawId: string): Promise<{ url: string; purchaseIntentId: string }> {
    if (!this.acceptsNewCheckout()) throw new CheckoutPausedError();
    const id = purchaseIntentId(rawId);
    const intent = await this.intents.findById(id);
    if (!intent) throw new PurchaseIntentNotFoundError();
    if (intent.commerceProvider && intent.commerceProvider !== "SHOPIFY") throw new ShopifyCheckoutConflictError();
    if (!["READY_FOR_CHECKOUT", "CHECKOUT_CREATED"].includes(intent.status)) throw new PurchaseIntentNotReadyError();
    if (!this.acceptsNewCheckout()) throw new CheckoutPausedError();
    const claim = await this.attempts.claim(id, this.createId(), this.carts.scope, this.now());
    if (!claim.owned) {
      if (claim.attempt.status !== "READY") {
        if (claim.attempt.status === "CREATING"
          && this.now().getTime() - claim.attempt.startedAt.getTime() >= SHOPIFY_STALE_ATTEMPT_MS) {
          await this.attempts.markUnknown(id, claim.attempt.id, this.now());
        }
        throw new ShopifyCheckoutUncertainError();
      }
      if (!this.acceptsNewCheckout()) throw new CheckoutPausedError();
      const cart = await this.carts.retrieve(claim.attempt.cartId, intent);
      if (cart.cartId !== claim.attempt.cartId || cart.purchaseIntentId !== id
        || cart.apiVersion !== claim.attempt.apiVersion) throw new ShopifyCheckoutConflictError();
      await this.attempts.complete(id, claim.attempt.id, cart, this.now());
      return { url: cart.checkoutUrl, purchaseIntentId: id };
    }
    try {
      // A pause after the durable claim conservatively leaves an unresolved attempt.
      if (!this.acceptsNewCheckout()) throw new CheckoutPausedError();
      const cart = await this.carts.create(intent);
      if (cart.purchaseIntentId !== id) throw new ShopifyCheckoutConflictError();
      // Never return a URL until credentials and the intent transition are committed.
      await this.attempts.complete(id, claim.attempt.id, cart, this.now());
      return { url: cart.checkoutUrl, purchaseIntentId: id };
    } catch {
      // If this write fails too, CREATING still prevents a second creation after a restart.
      await this.attempts.markUnknown(id, claim.attempt.id, this.now());
      throw new ShopifyCheckoutUncertainError();
    }
  }
}
