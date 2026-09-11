import { describe, expect, it } from "vitest";
import { reconcileFulfillmentQuantities, type ShopifyFulfillmentQuantities } from "./shopify-fulfillment-quantities";
const updatedAt = "2026-09-12T10:00:00Z";
const items = [{ variantId: "variant-1", quantity: 2 }, { variantId: "variant-2", quantity: 1 }];
const lines = [{ id: "line-1", variantId: "variant-1", quantity: 2, currentQuantity: 2 }, { id: "line-2", variantId: "variant-2", quantity: 1, currentQuantity: 1 }];
const part = { id: "fulfillment-1", status: "SUCCESS" as const, updatedAt, inTransitAt: updatedAt, deliveredAt: null,
  lines: [{ id: "fulfillment-line-1", lineItemId: "line-1", quantity: 1 }] };
const source: ShopifyFulfillmentQuantities = { updatedAt, lines, fulfillments: [part] };
function assessment(value: ShopifyFulfillmentQuantities | null) { return reconcileFulfillmentQuantities(items, value).assessment; }
describe("Shopify quantity reconciliation", () => {
  it("distinguishes no evidence, no transit, partial shipping, full shipping, partial delivery and full delivery", () => {
    expect(assessment(null)).toMatchObject({ status: "UNVERIFIED", shipped: null, delivered: null });
    expect(assessment({ ...source, fulfillments: [] })).toMatchObject({ status: "NONE", ordered: 3, shipped: 0, delivered: 0 });
    expect(assessment(source)).toMatchObject({ status: "PARTIALLY_SHIPPED", ordered: 3, shipped: 1, delivered: 0 });
    const rest = { ...part, id: "fulfillment-2", lines: [{ id: "fulfillment-line-2", lineItemId: "line-1", quantity: 1 }, { id: "fulfillment-line-3", lineItemId: "line-2", quantity: 1 }] };
    const shipped = { ...source, fulfillments: [part, rest] };
    expect(assessment(shipped)).toMatchObject({ status: "SHIPPED", shipped: 3, delivered: 0 });
    expect(assessment({ ...source, fulfillments: [{ ...part, deliveredAt: updatedAt }, rest] }))
      .toMatchObject({ status: "PARTIALLY_DELIVERED", shipped: 3, delivered: 1 });
    expect(assessment({ ...source, fulfillments: shipped.fulfillments.map((item) => ({ ...item, deliveredAt: updatedAt })) }))
      .toMatchObject({ status: "DELIVERED", shipped: 3, delivered: 3 });
  });
  it("matches quantities by product and order line instead of total count", () => {
    expect(assessment({ ...source, lines: [{ ...lines[0], quantity: 1, currentQuantity: 1 }, { ...lines[1], quantity: 2, currentQuantity: 2 }] }))
      .toMatchObject({ status: "REVIEW_REQUIRED", reason: "ORDER_ITEMS_CHANGED" });
    for (const changed of [{ ...lines[0], variantId: null }, { ...lines[0], variantId: "other-product" }, { ...lines[0], currentQuantity: 1 }]) {
      expect(assessment({ ...source, lines: [changed, lines[1]] }).reason).toBe("ORDER_ITEMS_CHANGED");
    }
    expect(assessment({ ...source, fulfillments: [{ ...part, lines: [{ ...part.lines[0], lineItemId: "foreign-line" }] }] }).reason).toBe("UNKNOWN_ORDER_LINE");
  });
  it("detects over-fulfillment including combined shipments and allocated-but-not-shipped records", () => {
    const rest = { ...part, id: "fulfillment-2", inTransitAt: null, lines: [{ ...part.lines[0], id: "fulfillment-line-2", quantity: 2 }] };
    expect(assessment({ ...source, fulfillments: [part, rest] })).toMatchObject({ status: "REVIEW_REQUIRED", reason: "QUANTITY_EXCEEDED", shipped: null });
    expect(assessment({ ...source, fulfillments: [{ ...part, inTransitAt: null }] }).status).toBe("NONE");
  });
  it("ignores a cancelled unshipped allocation but holds contradictory physical evidence and ambiguous statuses", () => {
    expect(assessment({ ...source, fulfillments: [{ ...part, status: "CANCELLED", inTransitAt: null }] }).status).toBe("NONE");
    for (const status of ["CANCELLED", "ERROR", "FAILURE", "OPEN", "PENDING"] as const) {
      expect(assessment({ ...source, fulfillments: [{ ...part, status }] }).reason).toBe("AMBIGUOUS_FULFILLMENT");
    }
  });
  it("rejects stale, missing and conflicting revisions without erasing the saved source", () => {
    const previous = { ...source, fulfillments: [{ ...part, deliveredAt: updatedAt }] };
    const invalid: ShopifyFulfillmentQuantities[] = [
      { ...source, updatedAt: "2026-09-12T09:00:00Z" }, { ...source, fulfillments: [] },
      { ...source, fulfillments: [{ ...part, updatedAt: "2026-09-12T09:00:00Z" }] },
      { ...source, lines: [{ ...lines[0], quantity: 1 }, lines[1]] }, source,
      { ...source, fulfillments: [{ ...part, updatedAt: "2026-09-12T11:00:00Z" }] },
    ];
    for (const next of invalid) {
      const result = reconcileFulfillmentQuantities(items, next, previous);
      expect(result.source).toEqual(previous);
      expect(result.assessment.status).toBe("REVIEW_REQUIRED");
    }
    expect(reconcileFulfillmentQuantities(items, null, previous)).toMatchObject({ source: previous, assessment: { status: "UNVERIFIED" } });
  });
});
