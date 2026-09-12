import { z } from "zod";
import content from "../../../../content/referral.json";
import { REFERRAL_POLICY } from "@/modules/referral/public";
import { formatMoney, money } from "@/shared/domain/money";

const text = z.string().trim().min(1).max(600);
export const referralContentSchema = z.object({
  navLabel: text, title: text, lead: text, previewNotice: text, friendBenefit: text, referrerBenefit: text,
  terms: text, create: text, copy: text, copyDone: text, copyFailed: text, linkLabel: text, codeLabel: text,
  join: text, joined: text, overviewTitle: text, pending: text, rewarded: text, coupons: text, noCoupons: text,
  statusAvailable: text, statusUsed: text, statusRevoked: text, statusExpired: text, welcome: text, thanks: text,
  browse: text, refresh: text, working: text, loadError: text, simulateTitle: text, newMember: text, swapMember: text,
  simulationNote: text, quoteAction: text, quoteNone: text, quoteApplied: text, quoteSkip: text, discountLabel: text,
  afterCheckoutTitle: text, deliverAction: text, refundAction: text, eventDone: text, showReferrals: text,
  expires: text, reviewNotice: text,
});
export const referralContent = referralContentSchema.parse(content);

export function referralCopy(template: string): string {
  return template.replaceAll("{discount}", formatMoney(money(REFERRAL_POLICY.discountMinor)))
    .replaceAll("{minimum}", formatMoney(money(REFERRAL_POLICY.minimumSubtotalMinor)))
    .replaceAll("{days}", String(REFERRAL_POLICY.validityDays))
    .replaceAll("{limit}", String(REFERRAL_POLICY.monthlyRewardLimit));
}
