export const FULFILLMENT_STATUSES = [
  "UNFULFILLED",
  "SCHEDULED",
  "PROCESSING",
  "READY",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

const ALLOWED_TRANSITIONS: Readonly<Record<FulfillmentStatus, readonly FulfillmentStatus[]>> = {
  UNFULFILLED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY", "CANCELLED"],
  READY: ["SHIPPED", "CANCELLED"],
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
