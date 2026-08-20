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
  create(intent: PurchaseIntent, idempotencyKey: string): Promise<CheckoutSession>;
  retrieve(externalCheckoutId: string): Promise<CheckoutSession>;
}
