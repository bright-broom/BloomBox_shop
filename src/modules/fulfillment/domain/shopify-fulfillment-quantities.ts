import type { ShopifyFulfillmentFact } from "./shopify-fulfillment-observation";
export type AcceptedFulfillmentItem = Readonly<{ variantId: string; quantity: number }>;
export type ShopifyFulfillmentQuantities = Readonly<{
  updatedAt: string;
  lines: readonly Readonly<{ id: string; variantId: string | null; quantity: number; currentQuantity: number }>[];
  fulfillments: readonly (ShopifyFulfillmentFact & Readonly<{
    lines: readonly Readonly<{ id: string; lineItemId: string; quantity: number }>[];
  }>)[];
}>;
export type FulfillmentQuantityAssessment = Readonly<{
  status: "UNVERIFIED" | "NONE" | "PARTIALLY_SHIPPED" | "SHIPPED" | "PARTIALLY_DELIVERED" | "DELIVERED" | "REVIEW_REQUIRED";
  reason: "SOURCE_UNAVAILABLE" | "ORDER_ITEMS_CHANGED" | "UNKNOWN_ORDER_LINE" | "QUANTITY_EXCEEDED" | "AMBIGUOUS_FULFILLMENT"
    | "SOURCE_REGRESSION" | "SOURCE_CONFLICT" | "MATCHED";
  ordered: number; shipped: number | null; delivered: number | null;
}>;
export type FulfillmentQuantityRecord = Readonly<{ source: ShopifyFulfillmentQuantities | null; assessment: FulfillmentQuantityAssessment }>;

/** All inputs are validated at the infrastructure boundary. No command/dispatch authorization is implied. */
export function reconcileFulfillmentQuantities(items: readonly AcceptedFulfillmentItem[], source: ShopifyFulfillmentQuantities | null,
  previous: ShopifyFulfillmentQuantities | null = null): FulfillmentQuantityRecord {
  const ordered = items.reduce((sum, item) => sum + item.quantity, 0);
  const review = (reason: FulfillmentQuantityAssessment["reason"], retained = source): FulfillmentQuantityRecord => ({ source: retained,
    assessment: { status: "REVIEW_REQUIRED", reason, ordered, shipped: null, delivered: null } });
  if (!source) return { source: previous, assessment: { status: "UNVERIFIED", reason: "SOURCE_UNAVAILABLE", ordered, shipped: null, delivered: null } };
  if (previous) {
    if (Date.parse(source.updatedAt) < Date.parse(previous.updatedAt)) return review("SOURCE_REGRESSION", previous);
    if (Date.parse(source.updatedAt) === Date.parse(previous.updatedAt) && JSON.stringify(source.lines) !== JSON.stringify(previous.lines)) return review("SOURCE_CONFLICT", previous);
    for (const old of previous.fulfillments) {
      const next = source.fulfillments.find((item) => item.id === old.id);
      if (!next || Date.parse(next.updatedAt) < Date.parse(old.updatedAt)) return review("SOURCE_REGRESSION", previous);
      if ((Date.parse(next.updatedAt) === Date.parse(old.updatedAt) && JSON.stringify(next) !== JSON.stringify(old))
        || (old.inTransitAt !== null && next.inTransitAt === null) || (old.deliveredAt !== null && next.deliveredAt === null)) {
        return review("SOURCE_CONFLICT", previous);
      }
    }
  }
  const expected = new Map<string, number>();
  for (const item of items) expected.set(item.variantId, (expected.get(item.variantId) ?? 0) + item.quantity);
  const actual = new Map<string, number>();
  for (const line of source.lines) {
    if (!line.variantId || line.quantity !== line.currentQuantity) return review("ORDER_ITEMS_CHANGED");
    actual.set(line.variantId, (actual.get(line.variantId) ?? 0) + line.quantity);
  }
  if (!ordered || !Number.isSafeInteger(ordered) || expected.size !== actual.size
    || [...expected].some(([id, quantity]) => actual.get(id) !== quantity)) return review("ORDER_ITEMS_CHANGED");
  const allocated = new Map<string, number>();
  let shipped = 0; let delivered = 0;
  for (const fulfillment of source.fulfillments) {
    if (fulfillment.status === "CANCELLED" && !fulfillment.inTransitAt && !fulfillment.deliveredAt) continue;
    if (fulfillment.status !== "SUCCESS") return review("AMBIGUOUS_FULFILLMENT");
    for (const line of fulfillment.lines) {
      const orderLine = source.lines.find((item) => item.id === line.lineItemId);
      if (!orderLine) return review("UNKNOWN_ORDER_LINE");
      const count = (allocated.get(line.lineItemId) ?? 0) + line.quantity;
      if (!Number.isSafeInteger(count) || count > orderLine.quantity) return review("QUANTITY_EXCEEDED");
      allocated.set(line.lineItemId, count);
      if (fulfillment.inTransitAt || fulfillment.deliveredAt) shipped += line.quantity;
      if (fulfillment.deliveredAt) delivered += line.quantity;
    }
  }
  return { source, assessment: { status: delivered === ordered ? "DELIVERED" : delivered > 0 ? "PARTIALLY_DELIVERED"
    : shipped === ordered ? "SHIPPED" : shipped > 0 ? "PARTIALLY_SHIPPED" : "NONE", reason: "MATCHED", ordered, shipped, delivered } };
}
