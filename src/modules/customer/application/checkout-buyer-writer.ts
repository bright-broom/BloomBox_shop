/** Bound to the caller's acceptance transaction; identity comes only from the persisted intent. */
export interface CheckoutBuyerWriter {
  create(input: Readonly<{ buyerId: string; purchaseIntentId: string; occurredAt: Date }>): Promise<void>;
}
export class CheckoutBuyerUnavailableError extends Error {
  constructor() { super("Checkout buyer unavailable"); this.name = "CheckoutBuyerUnavailableError"; }
}
