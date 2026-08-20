export const PAYMENT_STATUSES = [
  "REQUIRES_PAYMENT_METHOD",
  "REQUIRES_ACTION",
  "PROCESSING",
  "AUTHORIZED",
  "CAPTURED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "FAILED",
  "CANCELLED",
  "DISPUTED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const ALLOWED_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  REQUIRES_PAYMENT_METHOD: ["REQUIRES_ACTION", "PROCESSING", "FAILED", "CANCELLED"],
  REQUIRES_ACTION: ["PROCESSING", "FAILED", "CANCELLED"],
  PROCESSING: ["AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED"],
  AUTHORIZED: ["CAPTURED", "CANCELLED", "FAILED"],
  CAPTURED: ["PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"],
  REFUNDED: ["DISPUTED"],
  FAILED: [],
  CANCELLED: [],
  DISPUTED: ["PARTIALLY_REFUNDED", "REFUNDED", "CAPTURED"],
};

export class InvalidPaymentTransitionError extends Error {
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`Payment cannot transition from ${from} to ${to}`);
    this.name = "InvalidPaymentTransitionError";
  }
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidPaymentTransitionError(from, to);
  }
}
