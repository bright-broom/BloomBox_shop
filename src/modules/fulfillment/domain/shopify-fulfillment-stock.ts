import type { AcceptedFulfillmentItem } from "./shopify-fulfillment-quantities";
export const FULFILLMENT_STOCK_MAX_AGE_MS = 30_000;
export type ShopifyFulfillmentStockSnapshot = Readonly<{
  shop: string; orderId: string; test: boolean; orderUpdatedAt: string; checkedAt: string;
  allocations: readonly Readonly<{ id: string; updatedAt: string; status: string; requestStatus: string;
    canCreateFulfillment: boolean; locationId: string | null; locationActive: boolean;
    lines: readonly Readonly<{ id: string; variantId: string | null; inventoryItemId: string | null;
      quantity: number; remainingQuantity: number; requiresShipping: boolean }>[];
  }>[];
  stocks: readonly Readonly<{ inventoryItemId: string; locationId: string; tracked: boolean; active: boolean;
    updatedAt: string | null; available: number | null; committed: number | null; onHand: number | null }>[];
}>;
export type FulfillmentStockAssessment = Readonly<{ status: "UNVERIFIED" | "HELD" | "COVERED"; reason:
  "NOT_CONFIGURED" | "STALE_SNAPSHOT" | "ALLOCATION_BLOCKED" | "ORDER_ITEMS_CHANGED" | "STOCK_UNAVAILABLE"
  | "STOCK_UNTRACKED" | "STOCK_INCONSISTENT" | "STOCK_SHORTAGE" | "COMMITMENT_UNVERIFIED" | "COMMITMENTS_COVERED" }>;

/** Observes stock backing the assigned commitments; neither reserves stock nor grants dispatch permission. */
export function assessFulfillmentStock(items: readonly AcceptedFulfillmentItem[], snapshot: ShopifyFulfillmentStockSnapshot | null, now: Date): FulfillmentStockAssessment {
  if (!snapshot) return { status: "UNVERIFIED", reason: "NOT_CONFIGURED" };
  const age = now.getTime() - Date.parse(snapshot.checkedAt);
  if (!Number.isFinite(age) || age < 0 || age > FULFILLMENT_STOCK_MAX_AGE_MS) return { status: "UNVERIFIED", reason: "STALE_SNAPSHOT" };
  const held = (reason: FulfillmentStockAssessment["reason"]): FulfillmentStockAssessment => ({ status: "HELD", reason });
  if (!snapshot.allocations.length || snapshot.allocations.some((allocation) => allocation.status !== "OPEN"
    || allocation.requestStatus !== "UNSUBMITTED" || !allocation.canCreateFulfillment || !allocation.locationId || !allocation.locationActive
    || !allocation.lines.length || allocation.lines.some((line) => !line.requiresShipping || !line.quantity || line.quantity !== line.remainingQuantity))) {
    return held("ALLOCATION_BLOCKED");
  }
  const expected = new Map<string, number>(); const actual = new Map<string, number>(); const required = new Map<string, number>();
  for (const item of items) expected.set(item.variantId, (expected.get(item.variantId) ?? 0) + item.quantity);
  for (const allocation of snapshot.allocations) {
    for (const line of allocation.lines) {
      if (!line.variantId || !line.inventoryItemId) return held("STOCK_UNAVAILABLE");
      actual.set(line.variantId, (actual.get(line.variantId) ?? 0) + line.remainingQuantity);
      const key = `${allocation.locationId}:${line.inventoryItemId}`;
      required.set(key, (required.get(key) ?? 0) + line.remainingQuantity);
    }
  }
  if (!expected.size || actual.size !== expected.size || [...expected].some(([variantId, quantity]) => actual.get(variantId) !== quantity)) return held("ORDER_ITEMS_CHANGED");
  for (const [key, quantity] of required) {
    const stock = snapshot.stocks.find((item) => `${item.locationId}:${item.inventoryItemId}` === key);
    if (!stock || !stock.active || stock.available === null || stock.committed === null || stock.onHand === null) return held("STOCK_UNAVAILABLE");
    if (!stock.tracked) return held("STOCK_UNTRACKED");
    if (stock.committed < 0 || stock.available + stock.committed > stock.onHand) return held("STOCK_INCONSISTENT");
    if (stock.available < 0 || stock.onHand < stock.committed || stock.onHand < quantity) return held("STOCK_SHORTAGE");
    if (stock.committed < quantity) return held("COMMITMENT_UNVERIFIED");
  }
  return { status: "COVERED", reason: "COMMITMENTS_COVERED" };
}
