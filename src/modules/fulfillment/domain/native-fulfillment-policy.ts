import {
  NativeFulfillmentError,
  type NativeFulfillmentCommand,
  type NativeFulfillmentDecision,
  type NativeFulfillmentFacts,
} from "./native-fulfillment";

// #124 contract stub (ADR 0015). The domain agent replaces these bodies; signatures are frozen.

/** Pure decision for one operator command. Throws NativeFulfillmentError. */
export function decideNativeFulfillment(facts: NativeFulfillmentFacts, command: NativeFulfillmentCommand): NativeFulfillmentDecision {
  void facts;
  void command;
  throw new NativeFulfillmentError("UNAVAILABLE");
}

/** Returns the normalized tracking number, or null when the input is not acceptable. */
export function normalizeTrackingNumber(input: string): string | null {
  void input;
  return null;
}
