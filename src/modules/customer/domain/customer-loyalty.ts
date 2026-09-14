/** v1 is immutable: retain old versions when changing future purchase policy. */
export const LOYALTY_POLICY_VERSION = "rank-v1" as const;
export const LOYALTY_TIERS = Object.freeze([
  Object.freeze({ id: "SEED", thresholdYen: 0, basisPoints: 0 }),
  Object.freeze({ id: "SPROUT", thresholdYen: 12_000, basisPoints: 200 }),
  Object.freeze({ id: "BLOOM", thresholdYen: 30_000, basisPoints: 300 }),
  Object.freeze({ id: "BOUQUET", thresholdYen: 60_000, basisPoints: 500 }),
] as const);
export type LoyaltyTier = (typeof LOYALTY_TIERS)[number];
export type LoyaltyProgress = Readonly<{
  eligibleSpendYen: number; tier: LoyaltyTier; nextTier: LoyaltyTier | null;
  remainingYen: number; progressPercent: number;
}>;
export type LoyaltyQuote = Readonly<{
  version: typeof LOYALTY_POLICY_VERSION; tier: LoyaltyTier["id"];
  eligibleSpendYen: number; basisPoints: number; discountYen: number;
}>;
export class LoyaltyUnavailableError extends Error {
  constructor() { super("会員特典を確認できませんでした。時間をおいて、もう一度お試しください。"); this.name = "LoyaltyUnavailableError"; }
}
function amount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new LoyaltyUnavailableError();
}
export function loyaltyProgress(eligibleSpendYen: number): LoyaltyProgress {
  amount(eligibleSpendYen);
  const tier = [...LOYALTY_TIERS].reverse().find((item) => eligibleSpendYen >= item.thresholdYen)!;
  const nextTier = LOYALTY_TIERS.find((item) => item.thresholdYen > eligibleSpendYen) ?? null;
  return { eligibleSpendYen, tier, nextTier,
    remainingYen: nextTier ? nextTier.thresholdYen - eligibleSpendYen : 0,
    progressPercent: nextTier ? Math.floor((eligibleSpendYen - tier.thresholdYen) / (nextTier.thresholdYen - tier.thresholdYen) * 100) : 100 };
}
export function quoteLoyalty(eligibleSpendYen: number, subtotalYen: number): LoyaltyQuote {
  amount(subtotalYen);
  const { tier } = loyaltyProgress(eligibleSpendYen);
  return Object.freeze({ version: LOYALTY_POLICY_VERSION, tier: tier.id, eligibleSpendYen,
    basisPoints: tier.basisPoints,
    discountYen: Number(BigInt(subtotalYen) * BigInt(tier.basisPoints) / 10_000n) });
}
/** Revalidate persistence at the trust boundary, never trust a stored/client rate alone. */
export function restoreLoyaltyQuote(value: unknown, subtotalYen: number): LoyaltyQuote {
  if (!value || typeof value !== "object" || !("eligibleSpendYen" in value) || typeof value.eligibleSpendYen !== "number") throw new LoyaltyUnavailableError();
  const expected = quoteLoyalty(value.eligibleSpendYen, subtotalYen);
  if (Object.keys(value).length !== Object.keys(expected).length
    || Object.entries(expected).some(([key, item]) => !(key in value) || Reflect.get(value, key) !== item)) throw new LoyaltyUnavailableError();
  return expected;
}
