import { describe, expect, it } from "vitest";
import {
  assertPurchaseIntentTransition,
  InvalidPurchaseIntentTransitionError,
} from "./purchase-intent-status";

describe("purchase intent state machine", () => {
  it("allows checkout preparation before provider handoff", () => {
    expect(() => assertPurchaseIntentTransition("DRAFT", "READY_FOR_CHECKOUT")).not.toThrow();
    expect(() => assertPurchaseIntentTransition("READY_FOR_CHECKOUT", "CHECKOUT_CREATED")).not.toThrow();
  });

  it("allows conversion only after checkout exists", () => {
    expect(() => assertPurchaseIntentTransition("READY_FOR_CHECKOUT", "CONVERTED"))
      .toThrow(InvalidPurchaseIntentTransitionError);
  });

  it("keeps converted intents terminal", () => {
    expect(() => assertPurchaseIntentTransition("CONVERTED", "ABANDONED"))
      .toThrow(InvalidPurchaseIntentTransitionError);
  });
});
