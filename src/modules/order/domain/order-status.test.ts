import { describe, expect, it } from "vitest";
import { assertOrderTransition, InvalidOrderTransitionError } from "./order-status";

describe("order state machine", () => {
  it("allows an authoritative order to be confirmed", () => {
    expect(() => assertOrderTransition("PENDING_CONFIRMATION", "CONFIRMED")).not.toThrow();
  });

  it("does not contain payment or fulfillment transitions", () => {
    expect(() => assertOrderTransition("PENDING_CONFIRMATION", "CLOSED"))
      .toThrow(InvalidOrderTransitionError);
  });

  it("keeps terminal states terminal", () => {
    expect(() => assertOrderTransition("CANCELLED", "CONFIRMED"))
      .toThrow(InvalidOrderTransitionError);
  });
});
