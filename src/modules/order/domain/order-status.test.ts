import { describe, expect, it } from "vitest";
import { assertOrderTransition, InvalidOrderTransitionError } from "./order-status";

describe("order state machine", () => {
  it("allows the checkout transition", () => {
    expect(() => assertOrderTransition("DRAFT", "PENDING_PAYMENT")).not.toThrow();
  });

  it("does not allow payment to be skipped", () => {
    expect(() => assertOrderTransition("DRAFT", "PAID")).toThrow(InvalidOrderTransitionError);
  });

  it("keeps terminal states terminal", () => {
    expect(() => assertOrderTransition("CANCELLED", "PAID")).toThrow(InvalidOrderTransitionError);
  });
});
