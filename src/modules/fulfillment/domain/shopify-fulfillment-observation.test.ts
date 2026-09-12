import { describe, expect, it } from "vitest";
import { observeShopifyFulfillment, type ShopifyFulfillmentFact, type ShopifyFulfillmentObservation } from "./shopify-fulfillment-observation";
import { assessFulfillmentIntake, type FulfillmentIntakeFacts } from "./shopify-fulfillment-intake";
const fact: ShopifyFulfillmentFact = { id: "gid://shopify/Fulfillment/1", status: "SUCCESS",
  updatedAt: "2026-09-11T12:00:00Z", inTransitAt: null, deliveredAt: null };
const empty: ShopifyFulfillmentObservation = { activity: "UNVERIFIED", witness: null };
const facts: FulfillmentIntakeFacts = { status: "UNFULFILLED", orderStatus: "CONFIRMED", orderCancelled: true,
  total: 5000, captured: 5000, refunded: 5000, pendingTransactions: false, addressAvailable: false,
  deliveryDate: "2026-09-14", providerActivity: "UNVERIFIED" };
const now = new Date("2026-09-11T12:00:00Z");
describe("Shopify fulfillment observation", () => {
  it("distinguishes an unverified source from an empty response", () => {
    expect(observeShopifyFulfillment(empty, null)).toEqual(empty);
    expect(observeShopifyFulfillment(empty, [])).toEqual({ activity: "NONE", witness: null });
    expect(assessFulfillmentIntake(facts, { approval: "APPROVED" }, now))
      .toEqual({ kind: "HELD", reason: "PROVIDER_FULFILLMENT_UNVERIFIED" });
  });
  it.each(["SUCCESS", "CANCELLED", "FAILURE", "ERROR", "OPEN", "PENDING"] as const)("treats %s as recorded activity, not delivery", (status) => {
    expect(observeShopifyFulfillment(empty, [{ ...fact, status }])).toMatchObject({ activity: "RECORDED", witness: { status } });
  });
  it("retains a physical witness through empty, cancelled, stale, and repeated observations", () => {
    const transit = observeShopifyFulfillment(empty, [{ ...fact, inTransitAt: fact.updatedAt }]);
    const delivered = observeShopifyFulfillment(transit, [{ ...fact, deliveredAt: fact.updatedAt }]);
    expect(transit.activity).toBe("IN_TRANSIT");
    expect(delivered.activity).toBe("DELIVERED");
    for (const incoming of [null, [], [fact], [{ ...fact, status: "CANCELLED" as const }], [{ ...fact, inTransitAt: fact.updatedAt }]]) {
      expect(observeShopifyFulfillment(delivered, incoming)).toEqual(delivered);
    }
  });
  it.each(["RECORDED", "IN_TRANSIT", "DELIVERED"] as const)("holds cancellation on %s, including a late record after local cancellation", (providerActivity) => {
    for (const status of ["UNFULFILLED", "CANCELLED", "SHIPPED"] as const) {
      expect(assessFulfillmentIntake({ ...facts, status, providerActivity }, { approval: "APPROVED" }, now))
        .toEqual({ kind: "HELD", reason: "EXTERNAL_FULFILLMENT_REVIEW_REQUIRED" });
    }
  });
});
