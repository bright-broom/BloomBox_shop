import { describe, expect, it } from "vitest";
import { decideNativeFulfillment, normalizeTrackingNumber } from "./native-fulfillment-policy";
import { FULFILLMENT_STATUSES } from "./fulfillment-status";
import { NATIVE_FULFILLMENT_ACTIONS, type NativeFulfillmentAction, type NativeFulfillmentCommand, type NativeFulfillmentFacts } from "./native-fulfillment";
const facts: NativeFulfillmentFacts = { fulfillmentId: "sample", version: 1, status: "UNFULFILLED", orderStatus: "CONFIRMED", paymentStatuses: ["CAPTURED"], itemQuantity: 1, hasShipment: false };
const allowed: Record<NativeFulfillmentAction, readonly string[]> = {
  START_PREPARATION: ["UNFULFILLED"], MARK_READY: ["PROCESSING"], HOLD: ["UNFULFILLED", "PROCESSING", "READY"], RESUME: ["ON_HOLD"],
  CANCEL: ["UNFULFILLED", "PROCESSING", "READY", "ON_HOLD"], SHIP: ["READY"], CORRECT_TRACKING: ["SHIPPED", "DELIVERED"], MARK_DELIVERED: ["SHIPPED"],
};
function command(action: NativeFulfillmentAction): NativeFulfillmentCommand {
  const base = { fulfillmentId: "sample", requestId: "request", expectedVersion: 1 };
  if (action === "HOLD" || action === "CANCEL") return { ...base, action, reason: "CUSTOMER_REQUEST" };
  if (action === "SHIP" || action === "CORRECT_TRACKING") return { ...base, action, carrier: "YAMATO", trackingNumber: "1234-5678-9012" };
  return { ...base, action };
}
describe("native fulfillment decisions", () => {
  it.each(NATIVE_FULFILLMENT_ACTIONS)("allows only documented transitions for %s", (action) => {
    for (const status of FULFILLMENT_STATUSES) {
      const input = { ...facts, status, hasShipment: ["SHIPPED", "DELIVERED"].includes(status) };
      if (allowed[action].includes(status)) expect(decideNativeFulfillment(input, command(action))).toHaveProperty("toStatus");
      else expect(() => decideNativeFulfillment(input, command(action))).toThrowError(expect.objectContaining({ code: "TRANSITION_NOT_ALLOWED" }));
    }
  });
  it.each(["START_PREPARATION", "MARK_READY", "RESUME", "SHIP"] as const)("blocks preparation and dispatch for unsettled or inactive %s", (action) => {
    const state = action === "START_PREPARATION" ? "UNFULFILLED" : action === "MARK_READY" ? "PROCESSING" : action === "RESUME" ? "ON_HOLD" : "READY";
    expect(() => decideNativeFulfillment({ ...facts, status: state, orderStatus: "CANCELLED", paymentStatuses: ["REFUNDED"] }, command(action))).toThrowError(expect.objectContaining({ code: "ORDER_NOT_ACTIVE" }));
    for (const paymentStatuses of [[], ["REFUNDED"], ["PARTIALLY_REFUNDED"], ["DISPUTED"], ["CAPTURED", "REFUNDED"]]) {
      expect(() => decideNativeFulfillment({ ...facts, status: state, paymentStatuses }, command(action))).toThrowError(expect.objectContaining({ code: "PAYMENT_NOT_SETTLED" }));
    }
  });
  it("records delivery and corrections after refunds, without issuing money or inventory changes", () => {
    const input = { ...facts, status: "SHIPPED" as const, hasShipment: true, orderStatus: "CANCELLED" as const, paymentStatuses: ["REFUNDED"] };
    expect(decideNativeFulfillment(input, command("MARK_DELIVERED"))).toEqual({ toStatus: "DELIVERED", shipment: { kind: "MARK_DELIVERED" } });
    expect(decideNativeFulfillment(input, command("CORRECT_TRACKING"))).toMatchObject({ toStatus: "SHIPPED", shipment: { kind: "CORRECT", trackingNumber: "123456789012" } });
    expect(decideNativeFulfillment({ ...input, status: "ON_HOLD", hasShipment: false }, command("CANCEL"))).toEqual({ toStatus: "CANCELLED", shipment: { kind: "NONE" } });
  });
  it("refuses partial shipping, duplicate physical shipping and missing shipment facts", () => {
    expect(() => decideNativeFulfillment({ ...facts, status: "READY", itemQuantity: 2 }, command("SHIP"))).toThrowError(expect.objectContaining({ code: "MULTI_BOX_UNSUPPORTED" }));
    expect(() => decideNativeFulfillment({ ...facts, status: "READY", hasShipment: true }, command("SHIP"))).toThrowError(expect.objectContaining({ code: "TRANSITION_NOT_ALLOWED" }));
    expect(() => decideNativeFulfillment({ ...facts, status: "SHIPPED" }, command("MARK_DELIVERED"))).toThrowError(expect.objectContaining({ code: "TRANSITION_NOT_ALLOWED" }));
  });
  it("normalizes ASCII tracking codes and enforces boundaries before normalization", () => {
    expect(normalizeTrackingNumber(" abcd-1234 \n")).toBe("ABCD1234");
    expect(normalizeTrackingNumber("A".repeat(32))).toBe("A".repeat(32));
    for (const value of ["A".repeat(7), "A".repeat(33), "1234567ß", "１２３４５６７８", "https://tracking", "1234_5678", ""]) expect(normalizeTrackingNumber(value)).toBeNull();
  });
});
