import { describe, expect, it } from "vitest";
import {
  assertFulfillmentTransition,
  InvalidFulfillmentTransitionError,
} from "./fulfillment-status";

describe("fulfillment state machine", () => {
  it("allows the normal shipping sequence", () => {
    expect(() => assertFulfillmentTransition("UNFULFILLED", "SCHEDULED")).not.toThrow();
    expect(() => assertFulfillmentTransition("READY", "SHIPPED")).not.toThrow();
  });

  it("does not mark an unfulfilled order as delivered", () => {
    expect(() => assertFulfillmentTransition("UNFULFILLED", "DELIVERED"))
      .toThrow(InvalidFulfillmentTransitionError);
  });

  it("keeps cancelled fulfillment terminal", () => {
    expect(() => assertFulfillmentTransition("CANCELLED", "PROCESSING"))
      .toThrow(InvalidFulfillmentTransitionError);
  });
});
