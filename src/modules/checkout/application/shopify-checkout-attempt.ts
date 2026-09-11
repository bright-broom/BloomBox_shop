import type { PurchaseIntent, PurchaseIntentId } from "../domain/purchase-intent";

export type ShopifyCartHandoff = Readonly<{
  /** Secret capability: infrastructure encrypts it; never send to logs or analytics. */
  cartId: string;
  checkoutUrl: string;
  purchaseIntentId: string;
  apiVersion: string;
}>;

export interface ShopifyCartProvider {
  readonly scope: string;
  create(intent: PurchaseIntent): Promise<ShopifyCartHandoff>;
  retrieve(cartId: string, intent: PurchaseIntent): Promise<ShopifyCartHandoff>;
}

export type ShopifyCheckoutAttempt = Readonly<{
  id: string;
  startedAt: Date;
}> & (Readonly<{ status: "CREATING" | "UNKNOWN" }>
  | Readonly<{ status: "READY"; cartId: string; apiVersion: string }>);

export interface ShopifyCheckoutAttempts {
  /** Atomically pins the provider and claims once. Never reassigns an abandoned claim. */
  claim(intentId: PurchaseIntentId, attemptId: string, scope: string, now: Date): Promise<{
    owned: boolean; attempt: ShopifyCheckoutAttempt;
  }>;
  markUnknown(intentId: PurchaseIntentId, attemptId: string, now: Date): Promise<void>;
  complete(intentId: PurchaseIntentId, attemptId: string, handoff: ShopifyCartHandoff, now: Date): Promise<void>;
}

export class ShopifyCheckoutConflictError extends Error {
  constructor() { super("Shopify checkout attempt conflicts with persisted purchase state"); this.name = "ShopifyCheckoutConflictError"; }
}
export class ShopifyCheckoutUncertainError extends Error {
  constructor() { super("購入手続きの作成結果を確認中です。新しく作成せず、確認が終わるまでお待ちください。"); this.name = "ShopifyCheckoutUncertainError"; }
}
export class ShopifyCheckoutPersistenceError extends Error {
  constructor() { super("Shopify checkout attempt could not be persisted"); this.name = "ShopifyCheckoutPersistenceError"; }
}
