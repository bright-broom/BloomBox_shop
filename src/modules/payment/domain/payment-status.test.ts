import { describe, expect, it } from "vitest";
import { assertPaymentTransition, InvalidPaymentTransitionError } from "./payment-status";

describe("payment state machine", () => {
  it("allows a captured payment to become partially refunded", () => {
    expect(() => assertPaymentTransition("CAPTURED", "PARTIALLY_REFUNDED")).not.toThrow();
  });

  it("does not move a failed attempt directly to captured", () => {
    expect(() => assertPaymentTransition("FAILED", "CAPTURED"))
      .toThrow(InvalidPaymentTransitionError);
  });

  it("keeps payment states independent from order and fulfillment", () => {
    expect(() => assertPaymentTransition("CAPTURED", "CANCELLED"))
      .toThrow(InvalidPaymentTransitionError);
  });
});
