import { describe, expect, it } from "vitest";
import { ORDER_DELIVERY_DATE_REASON_MAX_LENGTH, OrderDeliveryDateChangeError, planOrderDeliveryDateChange, type OrderDeliveryDateCommand, type OrderDeliveryDateFacts } from "./order-delivery-date-change";
import { ORDER_PII_RETENTION_DAYS } from "./order-retention";

const facts: OrderDeliveryDateFacts = { orderStatus: "CONFIRMED", deliveryDate: "2026-10-01", fulfillmentStatuses: ["PROCESSING"],
  hasShipment: false, piiPurged: false, confirmedAt: new Date("2026-09-20T02:00:00Z") };
const command: OrderDeliveryDateCommand = { orderId: "order", requestId: "request", expectedDate: "2026-10-01", nextDate: "2026-10-08", reason: "購入者からのご相談" };
const window = { earliest: "2026-09-27", latest: "2026-11-23" };
const code = (fact: Partial<OrderDeliveryDateFacts>, input: Partial<OrderDeliveryDateCommand> = {}, range = window) => {
  try {
    planOrderDeliveryDateChange({ ...facts, ...fact }, { ...command, ...input }, range);
    return "ACCEPTED";
  } catch (error) {
    return error instanceof OrderDeliveryDateChangeError ? error.code : "UNEXPECTED";
  }
};

describe("order delivery date change", () => {
  it("moves the retention deadline with the delivery date", () => {
    const plan = planOrderDeliveryDateChange(facts, command, window);
    expect(plan).toMatchObject({ previousDate: "2026-10-01", nextDate: "2026-10-08", reason: "購入者からのご相談" });
    // The later of the new delivery date and the confirmation, plus the retention period.
    expect(plan.retentionExpiresAt.toISOString())
      .toBe(new Date(Date.parse("2026-10-08T00:00:00Z") + ORDER_PII_RETENTION_DAYS * 86_400_000).toISOString());
    // An earlier date brings the deletion forward again, so a change never leaves personal data longer than the rule.
    expect(planOrderDeliveryDateChange(facts, { ...command, nextDate: "2026-09-28" }, window).retentionExpiresAt.toISOString())
      .toBe(new Date(Date.parse("2026-09-28T00:00:00Z") + ORDER_PII_RETENTION_DAYS * 86_400_000).toISOString());
  });
  it("accepts the edges of the orderable range and rejects the days outside it", () => {
    expect(code({}, { nextDate: window.earliest })).toBe("ACCEPTED");
    expect(code({}, { nextDate: window.latest })).toBe("ACCEPTED");
    expect(code({}, { nextDate: "2026-09-26" })).toBe("OUT_OF_RANGE");
    expect(code({}, { nextDate: "2026-11-24" })).toBe("OUT_OF_RANGE");
  });
  it("refuses a change the system can no longer carry out", () => {
    expect(code({ hasShipment: true })).toBe("DISPATCHED");
    for (const status of ["SHIPPED", "DELIVERED", "FULFILLED", "RETURNED"]) expect(code({ fulfillmentStatuses: ["PROCESSING", status] })).toBe("DISPATCHED");
    for (const orderStatus of ["PENDING_CONFIRMATION", "CANCELLED", "CLOSED"]) expect(code({ orderStatus })).toBe("ORDER_NOT_ACTIVE");
    expect(code({ confirmedAt: null })).toBe("ORDER_NOT_ACTIVE");
    // Retention already removed the recipient and the address; there is nothing left to reschedule.
    expect(code({ piiPurged: true })).toBe("ORDER_NOT_ACTIVE");
  });
  it("requires the operator to have seen the current date and to state a reason", () => {
    expect(code({}, { expectedDate: "2026-10-02" })).toBe("CONFLICT");
    expect(code({}, { nextDate: facts.deliveryDate })).toBe("UNCHANGED");
    expect(code({}, { reason: "  " })).toBe("INVALID");
    expect(code({}, { reason: "あ".repeat(ORDER_DELIVERY_DATE_REASON_MAX_LENGTH + 1) })).toBe("INVALID");
    expect(planOrderDeliveryDateChange(facts, { ...command, reason: "  相談あり  " }, window).reason).toBe("相談あり");
  });
  it("rejects malformed dates and an impossible range instead of guessing", () => {
    for (const nextDate of ["2026-10-8", "20261008", "", "2026-10-08T00:00:00Z"]) expect(code({}, { nextDate })).toBe("INVALID");
    expect(code({ deliveryDate: "invalid" })).toBe("INVALID");
    expect(code({}, {}, { earliest: "2026-11-23", latest: "2026-09-27" })).toBe("INVALID");
  });
});
