/**
 * How long an order keeps the personal data of its gift (P0-17). The order itself — amounts, IDs, states —
 * is kept for accounting; only the encrypted buyer contact, recipient, address and message are removed.
 */
export const ORDER_PII_RETENTION_DAYS = 180;

const DAY_MS = 86_400_000;

export class InvalidOrderRetentionError extends Error {
  constructor() {
    super("Order retention input is invalid");
    this.name = "InvalidOrderRetentionError";
  }
}

/**
 * Counts from the later of the delivery date and the confirmation, so a gift ordered months ahead keeps its
 * address until it ships and still leaves the same window for delivery problems, returns and support.
 */
export function orderPiiRetentionExpiry(deliveryDate: string, confirmedAt: Date, days = ORDER_PII_RETENTION_DAYS): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || !Number.isSafeInteger(confirmedAt.getTime())) throw new InvalidOrderRetentionError();
  const delivery = new Date(`${deliveryDate}T00:00:00Z`);
  if (!Number.isSafeInteger(delivery.getTime()) || !Number.isSafeInteger(days) || days <= 0) throw new InvalidOrderRetentionError();
  const expiry = new Date(Math.max(delivery.getTime(), confirmedAt.getTime()) + days * DAY_MS);
  if (!Number.isSafeInteger(expiry.getTime())) throw new InvalidOrderRetentionError();
  return expiry;
}
