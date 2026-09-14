import type { FulfillmentStatus } from "./fulfillment-status";

// Native (Stripe) order fulfillment contract. ADR 0015. Changes are coordinated through the #124 lead.
export const NATIVE_FULFILLMENT_ACTIONS = [
  "START_PREPARATION", "MARK_READY", "HOLD", "RESUME", "CANCEL", "SHIP", "CORRECT_TRACKING", "MARK_DELIVERED",
] as const;
export type NativeFulfillmentAction = (typeof NATIVE_FULFILLMENT_ACTIONS)[number];

export const NATIVE_CARRIER_CODES = ["YAMATO", "SAGAWA", "JAPAN_POST"] as const;
export type NativeCarrierCode = (typeof NATIVE_CARRIER_CODES)[number];

export const NATIVE_FULFILLMENT_HOLD_REASONS = ["PAYMENT_REVIEW", "ADDRESS_REVIEW", "STOCK_SHORTAGE", "CUSTOMER_REQUEST", "OTHER"] as const;
export type NativeFulfillmentHoldReason = (typeof NATIVE_FULFILLMENT_HOLD_REASONS)[number];

export const NATIVE_FULFILLMENT_CANCEL_REASONS = ["CUSTOMER_REQUEST", "PAYMENT_ISSUE", "STOCK_SHORTAGE", "UNDELIVERABLE_ADDRESS", "OTHER"] as const;
export type NativeFulfillmentCancelReason = (typeof NATIVE_FULFILLMENT_CANCEL_REASONS)[number];

/** A normalized tracking number has no separators and uses uppercase ASCII letters and digits only. */
export const TRACKING_NUMBER_MIN_LENGTH = 8;
export const TRACKING_NUMBER_MAX_LENGTH = 32;

type NativeFulfillmentCommandBase = Readonly<{ fulfillmentId: string; requestId: string; expectedVersion: number }>;
export type NativeFulfillmentCommand = NativeFulfillmentCommandBase & (
  | Readonly<{ action: "START_PREPARATION" | "MARK_READY" | "RESUME" | "MARK_DELIVERED" }>
  | Readonly<{ action: "HOLD"; reason: NativeFulfillmentHoldReason }>
  | Readonly<{ action: "CANCEL"; reason: NativeFulfillmentCancelReason }>
  | Readonly<{ action: "SHIP" | "CORRECT_TRACKING"; carrier: NativeCarrierCode; trackingNumber: string }>
);

/** Facts locked inside the command transaction. Order and payment values are read-only snapshots. */
export type NativeFulfillmentFacts = Readonly<{
  fulfillmentId: string;
  status: FulfillmentStatus;
  version: number;
  orderStatus: "PENDING_CONFIRMATION" | "CONFIRMED" | "CANCELLED" | "CLOSED";
  /** Distinct payment statuses of the order. Only exactly ["CAPTURED"] counts as settled. */
  paymentStatuses: readonly string[];
  /** Total boxes across order items. Native checkout currently sells one box per order. */
  itemQuantity: number;
  hasShipment: boolean;
}>;

export type NativeShipmentEffect =
  | Readonly<{ kind: "NONE" }>
  | Readonly<{ kind: "CREATE" | "CORRECT"; carrier: NativeCarrierCode; trackingNumber: string }>
  | Readonly<{ kind: "MARK_DELIVERED" }>;

/** trackingNumber inside a shipment effect is always normalized. */
export type NativeFulfillmentDecision = Readonly<{ toStatus: FulfillmentStatus; shipment: NativeShipmentEffect }>;

export const NATIVE_FULFILLMENT_ERROR_CODES = [
  "INVALID", "DENIED", "NOT_FOUND", "CONFLICT", "TRANSITION_NOT_ALLOWED",
  "ORDER_NOT_ACTIVE", "PAYMENT_NOT_SETTLED", "MULTI_BOX_UNSUPPORTED", "UNAVAILABLE",
] as const;
export type NativeFulfillmentErrorCode = (typeof NATIVE_FULFILLMENT_ERROR_CODES)[number];

export class NativeFulfillmentError extends Error {
  constructor(readonly code: NativeFulfillmentErrorCode) {
    super(`Native fulfillment: ${code}`);
    this.name = "NativeFulfillmentError";
  }
}
