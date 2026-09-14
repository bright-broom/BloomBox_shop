/** Checkout's immutable copy of the Customer quote; no dependency on another domain. */
export type PurchaseLoyalty = Readonly<{
  version: string; tier: string; eligibleSpendYen: number; basisPoints: number; discountYen: number;
}>;
export class InvalidPurchaseLoyaltyError extends Error {
  constructor() { super("Invalid purchase loyalty snapshot"); this.name = "InvalidPurchaseLoyaltyError"; }
}
export function purchaseLoyalty(value: PurchaseLoyalty, subtotal: number): PurchaseLoyalty {
  if (!value.version || !value.tier || !Number.isSafeInteger(value.eligibleSpendYen) || value.eligibleSpendYen < 0
    || !Number.isSafeInteger(value.basisPoints) || value.basisPoints < 0 || value.basisPoints > 10_000
    || !Number.isSafeInteger(subtotal) || subtotal < 0 || !Number.isSafeInteger(value.discountYen)
    || value.discountYen !== Number(BigInt(subtotal) * BigInt(value.basisPoints) / 10_000n)) throw new InvalidPurchaseLoyaltyError();
  return Object.freeze({ ...value });
}
