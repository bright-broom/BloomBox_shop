import { describe, expect, it } from "vitest";
import { assessFulfillmentStock, FULFILLMENT_STOCK_MAX_AGE_MS, type ShopifyFulfillmentStockSnapshot } from "./shopify-fulfillment-stock";
import { assessFulfillmentIntake, type FulfillmentIntakeFacts } from "./shopify-fulfillment-intake";
const now = new Date("2026-09-11T12:00:00Z");
const items = [{ variantId: "variant-1", quantity: 1 }];
const source: ShopifyFulfillmentStockSnapshot = { shop: "shop.myshopify.com", orderId: "order-1", test: true, orderUpdatedAt: now.toISOString(), checkedAt: now.toISOString(),
  allocations: [{ id: "allocation-1", updatedAt: now.toISOString(), status: "OPEN", requestStatus: "UNSUBMITTED", canCreateFulfillment: true,
    locationId: "location-1", locationActive: true, lines: [{ id: "line-1", variantId: "variant-1", inventoryItemId: "stock-1", quantity: 1, remainingQuantity: 1, requiresShipping: true }] }],
  stocks: [{ inventoryItemId: "stock-1", locationId: "location-1", tracked: true, active: true, updatedAt: now.toISOString(), available: 0, committed: 1, onHand: 1 }] };
describe("allocated fulfillment stock", () => {
  it("recognizes committed stock even when no additional stock is available for sale", () => {
    expect(assessFulfillmentStock(items, source, now)).toEqual({ status: "COVERED", reason: "COMMITMENTS_COVERED" });
  });
  it.each([
    [{ available: -1, committed: 2, onHand: 1 }, "STOCK_SHORTAGE"], [{ available: 0, committed: 0, onHand: 1 }, "COMMITMENT_UNVERIFIED"],
    [{ available: 1, committed: 1, onHand: 1 }, "STOCK_INCONSISTENT"], [{ tracked: false }, "STOCK_UNTRACKED"],
    [{ active: false }, "STOCK_UNAVAILABLE"], [{ available: null }, "STOCK_UNAVAILABLE"], [{ locationId: "another-location" }, "STOCK_UNAVAILABLE"],
  ] as const)("holds unavailable, oversold, untracked and inconsistent stock %j", (override, reason) => {
    expect(assessFulfillmentStock(items, { ...source, stocks: [{ ...source.stocks[0], ...override }] }, now)).toEqual({ status: "HELD", reason });
  });
  it("aggregates shared inventory across allocations instead of reusing one committed unit", () => {
    const second = { ...source.allocations[0], id: "allocation-2", lines: [{ ...source.allocations[0].lines[0], id: "line-2", variantId: "variant-2" }] };
    expect(assessFulfillmentStock([...items, { variantId: "variant-2", quantity: 1 }], { ...source, allocations: [...source.allocations, second] }, now))
      .toEqual({ status: "HELD", reason: "STOCK_SHORTAGE" });
  });
  it.each([{ status: "ON_HOLD" }, { requestStatus: "SUBMITTED" }, { locationActive: false }, { canCreateFulfillment: false }])("holds blocked provider allocations %j", (override) => {
    expect(assessFulfillmentStock(items, { ...source, allocations: [{ ...source.allocations[0], ...override }] }, now).reason).toBe("ALLOCATION_BLOCKED");
  });
  it("matches accepted products and rejects partial remaining allocation", () => {
    expect(assessFulfillmentStock([{ variantId: "wrong-product", quantity: 1 }], source, now).reason).toBe("ORDER_ITEMS_CHANGED");
    const allocation = source.allocations[0];
    expect(assessFulfillmentStock(items, { ...source, allocations: [{ ...allocation, lines: [{ ...allocation.lines[0], remainingQuantity: 0 }] }] }, now).reason).toBe("ALLOCATION_BLOCKED");
  });
  it("requires a fresh read and never reuses cached coverage as dispatch permission", () => {
    expect(assessFulfillmentStock(items, null, now).status).toBe("UNVERIFIED");
    expect(assessFulfillmentStock(items, source, new Date(now.getTime() + FULFILLMENT_STOCK_MAX_AGE_MS + 1)).reason).toBe("STALE_SNAPSHOT");
    expect(assessFulfillmentStock(items, source, new Date(now.getTime() - 1)).reason).toBe("STALE_SNAPSHOT");
    const facts: FulfillmentIntakeFacts = { status: "UNFULFILLED", orderStatus: "CONFIRMED", orderCancelled: false,
      total: 5000, captured: 5000, refunded: 0, pendingTransactions: false, addressAvailable: true, deliveryDate: "2026-09-14", providerActivity: "NONE",
      stockAssessment: assessFulfillmentStock(items, source, now), quantityAssessment: { status: "NONE", reason: "MATCHED", ordered: 1, shipped: 0, delivered: 0 } };
    expect(assessFulfillmentIntake(facts, { approval: "APPROVED" }, now)).toEqual({ kind: "HELD", reason: "DISPATCH_APPROVAL_REQUIRED" });
    expect(assessFulfillmentIntake({ ...facts, quantityAssessment: undefined }, { approval: "APPROVED" }, now).reason).toBe("FULFILLMENT_QUANTITIES_UNVERIFIED");
    expect(assessFulfillmentIntake(facts, { approval: "PENDING" }, now).reason).toBe("POLICY_NOT_APPROVED");
  });
});
