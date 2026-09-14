import { describe, expect, it } from "vitest";
import { loyaltyProgress, quoteLoyalty, restoreLoyaltyQuote } from "./customer-loyalty";

describe("rank-v1 policy", () => {
  it.each([[0,"SEED",0],[11999,"SEED",0],[12000,"SPROUT",200],[29999,"SPROUT",200],[30000,"BLOOM",300],[59999,"BLOOM",300],[60000,"BOUQUET",500]] as const)("spend %i selects %s", (spend, tier, rate) => {
    expect(quoteLoyalty(spend, 4000)).toMatchObject({ tier, basisPoints: rate });
  });
  it("shows remaining spend within the current tier and a complete top rank", () => {
    expect(loyaltyProgress(21000)).toMatchObject({ remainingYen: 9000, progressPercent: 50 });
    expect(loyaltyProgress(60000)).toMatchObject({ remainingYen: 0, progressPercent: 100, nextTier: null });
    expect(loyaltyProgress(0)).toMatchObject({ remainingYen: 12000, progressPercent: 0 });
  });
  it("floors yen exactly, including safe-integer limits without floating point multiplication", () => {
    expect(quoteLoyalty(12000, 49).discountYen).toBe(0);
    expect(quoteLoyalty(12000, 50).discountYen).toBe(1);
    expect(quoteLoyalty(60000, Number.MAX_SAFE_INTEGER).discountYen).toBe(450359962737049);
  });
  it.each([-1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1])("rejects invalid monetary value %s", (value) => {
    expect(() => loyaltyProgress(value)).toThrow(); expect(() => quoteLoyalty(0, value)).toThrow();
  });
  it("restores only a matching version, tier, rate, amount and exact quote shape", () => {
    const quote = quoteLoyalty(12000, 4000);
    expect(restoreLoyaltyQuote(JSON.parse(JSON.stringify(quote)), 4000)).toEqual(quote);
    for (const value of [null, {}, { ...quote, version: "rank-v99" }, { ...quote, tier: "BOUQUET" },
      { ...quote, basisPoints: 500 }, { ...quote, eligibleSpendYen: "12000" }, { ...quote, discountYen: 81 }, { ...quote, extra: true }]) {
      expect(() => restoreLoyaltyQuote(value, 4000)).toThrow();
    }
    expect(Object.isFrozen(quote)).toBe(true);
  });
});
