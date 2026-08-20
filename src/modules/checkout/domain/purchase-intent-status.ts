export const PURCHASE_INTENT_STATUSES = [
  "DRAFT",
  "READY_FOR_CHECKOUT",
  "CHECKOUT_CREATED",
  "CONVERTED",
  "EXPIRED",
  "ABANDONED",
] as const;

export type PurchaseIntentStatus = (typeof PURCHASE_INTENT_STATUSES)[number];

const ALLOWED_TRANSITIONS: Readonly<Record<PurchaseIntentStatus, readonly PurchaseIntentStatus[]>> = {
  DRAFT: ["READY_FOR_CHECKOUT", "ABANDONED"],
  READY_FOR_CHECKOUT: ["CHECKOUT_CREATED", "EXPIRED", "ABANDONED"],
  CHECKOUT_CREATED: ["CONVERTED", "EXPIRED", "ABANDONED"],
  CONVERTED: [],
  EXPIRED: [],
  ABANDONED: [],
};

export class InvalidPurchaseIntentTransitionError extends Error {
  constructor(from: PurchaseIntentStatus, to: PurchaseIntentStatus) {
    super(`Purchase intent cannot transition from ${from} to ${to}`);
    this.name = "InvalidPurchaseIntentTransitionError";
  }
}

export function assertPurchaseIntentTransition(
  from: PurchaseIntentStatus,
  to: PurchaseIntentStatus,
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidPurchaseIntentTransitionError(from, to);
  }
}
