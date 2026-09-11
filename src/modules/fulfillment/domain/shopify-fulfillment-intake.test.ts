import { describe, expect, it } from "vitest";
import { assessFulfillmentIntake, type FulfillmentIntakeFacts } from "./shopify-fulfillment-intake";
import { FULFILLMENT_STATUSES } from "./fulfillment-status";

const now = new Date("2026-09-11T12:00:00Z");
const facts: FulfillmentIntakeFacts = { status: null, orderStatus: "CONFIRMED", orderCancelled: false,
  total: 5000, captured: 5000, refunded: 0, pendingTransactions: false, addressAvailable: true, deliveryDate: "2026-09-14" };
const approved = { approval: "APPROVED" } as const;
describe("Shopify fulfillment intake decisions", () => {
  it("never authorizes shipping even if the policy is approved, without verified inventory", () => {
    expect(assessFulfillmentIntake(facts, { approval: "PENDING" }, now)).toEqual({ kind: "HELD", reason: "POLICY_NOT_APPROVED" });
    expect(assessFulfillmentIntake(facts, approved, now)).toEqual({ kind: "HELD", reason: "INVENTORY_UNVERIFIED" });
  });
  it.each([
    [{ orderStatus: "CLOSED" }, "ORDER_NOT_CONFIRMED"], [{ refunded: 500 }, "PARTIAL_REFUND"],
    [{ captured: 4500 }, "PAYMENT_UNSETTLED"], [{ pendingTransactions: true }, "PAYMENT_PENDING"],
    [{ addressAvailable: false }, "ADDRESS_UNAVAILABLE"], [{ deliveryDate: "2026-09-13" }, "DELIVERY_UNAVAILABLE"],
  ] as const)("holds unresolved prerequisites %j", (override, reason) => {
    expect(assessFulfillmentIntake({ ...facts, ...override }, approved, now)).toEqual({ kind: "HELD", reason });
  });
  it("cancels untouched intake on full refunds/cancellation even after PII and date expiry", () => {
    expect(assessFulfillmentIntake({ ...facts, refunded: 5000, addressAvailable: false }, { approval: "PENDING" }, new Date("2026-11-01")))
      .toEqual({ kind: "CANCELLED", reason: "FULLY_REFUNDED" });
    expect(assessFulfillmentIntake({ ...facts, status: "UNFULFILLED", orderCancelled: true }, approved, now))
      .toEqual({ kind: "CANCELLED", reason: "ORDER_CANCELLED" });
  });
  it.each(FULFILLMENT_STATUSES)("handles cancellation safely from %s", (status) => {
    const result = assessFulfillmentIntake({ ...facts, status, orderCancelled: true }, approved, now);
    const expected = ["UNFULFILLED", "CANCELLED"].includes(status) ? { kind: "CANCELLED", reason: "ORDER_CANCELLED" }
      : ["SHIPPED", "DELIVERED", "RETURNED"].includes(status) ? { kind: "HELD", reason: "POST_SHIPMENT_REVIEW_REQUIRED" }
      : { kind: "HELD", reason: "ACTIVE_FULFILLMENT_REVIEW_REQUIRED" };
    expect(result).toEqual(expected);
  });
  it("never reopens cancelled intake and rechecks midnight cutoffs", () => {
    expect(assessFulfillmentIntake({ ...facts, status: "CANCELLED" }, approved, now)).toEqual({ kind: "CANCELLED", reason: "ALREADY_CANCELLED" });
    expect(assessFulfillmentIntake(facts, approved, new Date("2026-09-11T15:00:00Z"))).toEqual({ kind: "HELD", reason: "DELIVERY_UNAVAILABLE" });
  });
});
