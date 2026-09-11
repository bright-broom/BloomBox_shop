export const REFERRAL_CODE_LENGTH = 27;
export const REFERRAL_POLICY = Object.freeze({
  version: "2026-09-v1",
  discountMinor: 500,
  minimumSubtotalMinor: 5_500,
  validityDays: 90,
  monthlyRewardLimit: 5,
});

export function referralExpiry(now: Date): string {
  return new Date(now.getTime() + REFERRAL_POLICY.validityDays * 86_400_000).toISOString();
}

export function referralMonth(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 7);
}

export class ReferralRuleError extends Error {
  constructor(readonly code: "SELF_REFERRAL" | "UNKNOWN_INVITE" | "ALREADY_JOINED" | "FIRST_ORDER_ONLY"
    | "INVALID_COUPON" | "ORDER_CONFLICT" | "NOT_FOUND" | "INVALID_AMOUNT") {
    super(code);
    this.name = "ReferralRuleError";
  }
}
