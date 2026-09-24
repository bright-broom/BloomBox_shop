import { describe, expect, it } from "vitest";
import { InvalidOrderChangeWindowError, ORDER_CHANGE_DEADLINE_DAYS, orderChangeWindow, orderDispatched } from "./order-change-window";

describe("orderChangeWindow", () => {
  it("stays open until the end of the day four days before delivery, in Tokyo time", () => {
    // Delivery 2026-10-10 → requests are in time through 2026-10-06 (JST).
    expect(orderChangeWindow("2026-10-10", new Date("2026-10-06T14:59:59Z"))).toEqual({ lastDay: "2026-10-06", open: true });
    // 2026-10-06T15:00Z is 2026-10-07T00:00 in Tokyo: the window has closed.
    expect(orderChangeWindow("2026-10-10", new Date("2026-10-06T15:00:00Z")).open).toBe(false);
    expect(orderChangeWindow("2026-10-10", new Date("2026-10-06T14:59:59Z")).open).toBe(true);
  });

  it("is already closed for the earliest orderable delivery date", () => {
    // The gift form allows delivery three days out, which is inside the four-day deadline.
    expect(orderChangeWindow("2026-10-10", new Date("2026-10-07T01:00:00Z")).open).toBe(false);
    expect(ORDER_CHANGE_DEADLINE_DAYS).toBe(4);
  });

  it("names the last day for a delivery at the start of a month", () => {
    expect(orderChangeWindow("2026-03-01", new Date("2026-02-20T00:00:00Z"))).toEqual({ lastDay: "2026-02-25", open: true });
  });

  it.each(["2026-10-1", "20261010", "", "not-a-date"])("rejects the malformed delivery date %j", (value) => {
    expect(() => orderChangeWindow(value, new Date("2026-10-01T00:00:00Z"))).toThrow(InvalidOrderChangeWindowError);
  });

  it("rejects an invalid clock", () => {
    expect(() => orderChangeWindow("2026-10-10", new Date(Number.NaN))).toThrow(InvalidOrderChangeWindowError);
  });
});

describe("orderDispatched", () => {
  it("treats states after hand-off to the carrier as beyond change", () => {
    for (const state of ["SHIPPED", "DELIVERED", "FULFILLED", "RETURNED"]) expect(orderDispatched(state)).toBe(true);
    for (const state of ["PENDING_FULFILLMENT", "PROCESSING", "READY", "ON_HOLD", "UNKNOWN", "", "shipped"]) expect(orderDispatched(state)).toBe(false);
  });
});
