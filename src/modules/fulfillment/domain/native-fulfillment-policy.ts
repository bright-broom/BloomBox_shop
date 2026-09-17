import { NativeFulfillmentError, NATIVE_CARRIER_CODES, NATIVE_FULFILLMENT_CANCEL_REASONS,
  NATIVE_FULFILLMENT_HOLD_REASONS, TRACKING_NUMBER_MIN_LENGTH, TRACKING_NUMBER_MAX_LENGTH,
  type NativeFulfillmentCommand, type NativeFulfillmentDecision, type NativeFulfillmentFacts,
} from "./native-fulfillment";
import type { FulfillmentStatus } from "./fulfillment-status";

const transitions: Readonly<Record<NativeFulfillmentCommand["action"], readonly FulfillmentStatus[]>> = {
  START_PREPARATION: ["UNFULFILLED"], MARK_READY: ["PROCESSING"], HOLD: ["UNFULFILLED", "PROCESSING", "READY"],
  RESUME: ["ON_HOLD"], CANCEL: ["UNFULFILLED", "PROCESSING", "READY", "ON_HOLD"],
  SHIP: ["READY"], CORRECT_TRACKING: ["SHIPPED", "DELIVERED"], MARK_DELIVERED: ["SHIPPED"],
};

export function normalizeTrackingNumber(input: string): string | null {
  if (/[^a-zA-Z0-9\s-]/.test(input)) return null;
  const value = input.replace(/[\s-]/g, "").toUpperCase();
  return value.length >= TRACKING_NUMBER_MIN_LENGTH && value.length <= TRACKING_NUMBER_MAX_LENGTH && /^[A-Z0-9]+$/.test(value) ? value : null;
}

/** Only physical shipping facts change here; cancellation never implies refund or restocking. */
export function decideNativeFulfillment(facts: NativeFulfillmentFacts, command: NativeFulfillmentCommand): NativeFulfillmentDecision {
  const tracking = command.action === "SHIP" || command.action === "CORRECT_TRACKING" ? normalizeTrackingNumber(command.trackingNumber) : null;
  if ((command.action === "HOLD" && !NATIVE_FULFILLMENT_HOLD_REASONS.includes(command.reason))
    || (command.action === "CANCEL" && !NATIVE_FULFILLMENT_CANCEL_REASONS.includes(command.reason))
    || ((command.action === "SHIP" || command.action === "CORRECT_TRACKING") && (!tracking || !NATIVE_CARRIER_CODES.includes(command.carrier)))) {
    throw new NativeFulfillmentError("INVALID");
  }
  if (!transitions[command.action]?.includes(facts.status)
    || (command.action === "SHIP" && facts.hasShipment)
    || ((command.action === "CORRECT_TRACKING" || command.action === "MARK_DELIVERED") && !facts.hasShipment)) {
    throw new NativeFulfillmentError("TRANSITION_NOT_ALLOWED");
  }
  if (["START_PREPARATION", "MARK_READY", "RESUME", "SHIP"].includes(command.action)) {
    if (facts.orderStatus !== "CONFIRMED") throw new NativeFulfillmentError("ORDER_NOT_ACTIVE");
    if (facts.paymentStatuses.length !== 1 || facts.paymentStatuses[0] !== "CAPTURED") throw new NativeFulfillmentError("PAYMENT_NOT_SETTLED");
  }
  if (command.action === "SHIP" && facts.itemQuantity !== 1) throw new NativeFulfillmentError("MULTI_BOX_UNSUPPORTED");
  switch (command.action) {
    case "START_PREPARATION": case "RESUME": return { toStatus: "PROCESSING", shipment: { kind: "NONE" } };
    case "MARK_READY": return { toStatus: "READY", shipment: { kind: "NONE" } };
    case "HOLD": return { toStatus: "ON_HOLD", shipment: { kind: "NONE" } };
    case "CANCEL": return { toStatus: "CANCELLED", shipment: { kind: "NONE" } };
    case "SHIP": case "CORRECT_TRACKING":
      if (!tracking) throw new NativeFulfillmentError("INVALID");
      return { toStatus: command.action === "SHIP" ? "SHIPPED" : facts.status,
        shipment: { kind: command.action === "SHIP" ? "CREATE" : "CORRECT", carrier: command.carrier, trackingNumber: tracking } };
    case "MARK_DELIVERED": return { toStatus: "DELIVERED", shipment: { kind: "MARK_DELIVERED" } };
  }
}
