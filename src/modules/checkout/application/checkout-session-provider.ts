import type { CommerceProvider, PurchaseIntent } from "../domain/purchase-intent";

export type CheckoutSession = Readonly<{
  provider: CommerceProvider;
  id: string;
  purchaseIntentId: string;
  url: string;
  expiresAt: Date;
  apiVersion: string;
}>;

export interface CheckoutSessionProvider {
  readonly provider: CommerceProvider;
  /** Validate local configuration and the saved request without I/O or state changes. */
  validateCreate(intent: PurchaseIntent): void;
  create(intent: PurchaseIntent, idempotencyKey: string): Promise<CheckoutSession>;
  retrieve(externalCheckoutId: string): Promise<CheckoutSession>;
}

export class CheckoutPreparationUnavailableError extends Error {
  constructor() {
    super("決済手続きを進められません。時間をおいて、同じカートから再度お試しください。");
    this.name = "CheckoutPreparationUnavailableError";
  }
}
