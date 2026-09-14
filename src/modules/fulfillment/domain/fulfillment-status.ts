export const FULFILLMENT_STATUSES = [
  "UNFULFILLED",
  "SCHEDULED",
  "PROCESSING",
  "READY",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
  "ON_HOLD",
] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

// SCHEDULED is used only by legacy Shopify intake. Native operations start at PROCESSING (ADR 0015).
const ALLOWED_TRANSITIONS: Readonly<Record<FulfillmentStatus, readonly FulfillmentStatus[]>> = {
  UNFULFILLED: ["SCHEDULED", "PROCESSING", "ON_HOLD", "CANCELLED"],
  SCHEDULED: ["PROCESSING", "ON_HOLD", "CANCELLED"],
  PROCESSING: ["READY", "ON_HOLD", "CANCELLED"],
  READY: ["SHIPPED", "ON_HOLD", "CANCELLED"],
  ON_HOLD: ["PROCESSING", "CANCELLED"],
  SHIPPED: ["DELIVERED", "RETURNED"],
  DELIVERED: ["RETURNED"],
  CANCELLED: [],
  RETURNED: [],
};

export class InvalidFulfillmentTransitionError extends Error {
  constructor(from: FulfillmentStatus, to: FulfillmentStatus) {
    super(`Fulfillment cannot transition from ${from} to ${to}`);
    this.name = "InvalidFulfillmentTransitionError";
  }
}

export function assertFulfillmentTransition(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidFulfillmentTransitionError(from, to);
  }
}
