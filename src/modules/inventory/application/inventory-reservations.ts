export type InventoryReleaseReason = "BEFORE_CHECKOUT_CANCELLED" | "INTENT_EXPIRED" | "CHECKOUT_EXPIRED" | "PAYMENT_FAILED";
/** Bound to the owning commerce transaction. Quantities come from the persisted purchase. */
export interface InventoryReservations {
  reserve(purchaseIntentId: string): Promise<void>;
  commit(purchaseIntentId: string, occurredAt: Date): Promise<void>;
  release(purchaseIntentId: string, reason: InventoryReleaseReason, occurredAt: Date): Promise<void>;
}
export interface StockAvailabilityReader {
  availableProductIds(productIds: readonly string[]): Promise<ReadonlySet<string>>;
}
