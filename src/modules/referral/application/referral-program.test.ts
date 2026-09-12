import { describe, expect, it } from "vitest";
import { ReferralProgram } from "./referral-program";
import { REFERRAL_POLICY, ReferralRuleError } from "../domain/referral-policy";

const now = new Date("2026-09-11T00:00:00Z");
function setup() {
  const program = new ReferralProgram();
  program.enroll("owner-secret", "OWNER");
  program.enroll("friend-secret", "FRIEND");
  program.enroll("another-secret", "ANOTHER");
  program.join("friend-secret", "OWNER", now);
  return program;
}
function pay(program: ReferralProgram, id = "order-1", buyerId = "friend-secret", date = now) {
  return program.recordPaidOrder({ id, buyerId, subtotalMinor: 6600, fingerprint: "product:1",
    couponId: program.quote(buyerId, 6600, date).couponId }, date);
}

describe("referral rewards", () => {
  it("offers one welcome discount, and issues the referrer's coupon only after delivery", () => {
    const program = setup();
    expect(pay(program).discountMinor).toBe(500);
    expect(program.snapshot("owner-secret", now)).toMatchObject({ pendingCount: 1, coupons: [] });
    program.deliver("order-1", "friend-secret", now);
    program.deliver("order-1", "friend-secret", now);
    const result = program.snapshot("owner-secret", now);
    expect(result).toMatchObject({ pendingCount: 0, rewardedCount: 1 });
    expect(result.coupons).toHaveLength(1);
    expect(program.quote("owner-secret", 6600, now).discountMinor).toBe(500);
  });

  it("rejects self referrals, unknown codes and attribution replacement", () => {
    const program = setup();
    expect(() => program.join("owner-secret", "OWNER", now)).toThrow("SELF_REFERRAL");
    expect(() => program.join("another-secret", "MISSING", now)).toThrow("UNKNOWN_INVITE");
    expect(() => program.join("friend-secret", "ANOTHER", now)).toThrow("ALREADY_JOINED");
  });

  it("does not extend coupon expiry or mint another coupon on a repeated invite claim", () => {
    const program = setup();
    const first = program.snapshot("friend-secret", now);
    program.join("friend-secret", "OWNER", new Date("2027-01-01T00:00:00Z"));
    expect(program.snapshot("friend-secret", now)).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("friend-secret");
    expect(JSON.stringify(first)).not.toContain("owner-secret");
  });

  it("enforces the minimum product subtotal and exact expiry without discounting shipping", () => {
    const program = setup();
    expect(program.quote("friend-secret", 5499, now).discountMinor).toBe(0);
    expect(program.quote("friend-secret", 5500, now).discountMinor).toBe(500);
    const expiry = new Date(program.snapshot("friend-secret", now).coupons[0].expiresAt);
    expect(program.quote("friend-secret", 5500, new Date(expiry.getTime() - 1)).discountMinor).toBe(500);
    expect(program.quote("friend-secret", 5500, expiry).discountMinor).toBe(0);
    expect(program.snapshot("friend-secret", expiry).coupons[0].status).toBe("EXPIRED");
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid monetary input %s", (amount) => {
    expect(() => setup().quote("friend-secret", amount, now)).toThrow(ReferralRuleError);
  });

  it("replays the same settlement without consuming another coupon, and rejects changed order data", () => {
    const program = setup();
    const couponId = program.quote("friend-secret", 6600, now).couponId;
    const request = { id: "order-1", buyerId: "friend-secret", subtotalMinor: 6600, fingerprint: "product:1", couponId };
    expect(program.recordPaidOrder(request, now)).toEqual(program.recordPaidOrder(request, now));
    expect(() => program.recordPaidOrder({ ...request, fingerprint: "other-product:1" }, now)).toThrow("ORDER_CONFLICT");
    expect(() => program.recordPaidOrder({ ...request, subtotalMinor: 7000 }, now)).toThrow("ORDER_CONFLICT");
    expect(() => program.recordPaidOrder({ ...request, buyerId: "another-secret" }, now)).toThrow("ORDER_CONFLICT");
    expect(() => program.recordPaidOrder({ ...request, id: "order-2" }, now)).toThrow("INVALID_COUPON");
    expect(program.orderCount).toBe(1);
  });

  it("rejects another buyer's coupon and order operations without leaking their data", () => {
    const program = setup();
    const couponId = program.quote("friend-secret", 6600, now).couponId;
    expect(() => program.recordPaidOrder({ id: "bad", buyerId: "another-secret", subtotalMinor: 6600,
      fingerprint: "product:1", couponId }, now)).toThrow("INVALID_COUPON");
    pay(program);
    expect(() => program.deliver("order-1", "another-secret", now)).toThrow("NOT_FOUND");
    expect(() => program.reverse("order-1", "another-secret")).toThrow("NOT_FOUND");
  });

  it("a first purchase without using a coupon still closes initial-purchase eligibility", () => {
    const program = setup();
    program.recordPaidOrder({ id: "small", buyerId: "friend-secret", subtotalMinor: 5000, fingerprint: "small:1", couponId: null }, now);
    expect(program.quote("friend-secret", 6600, now).discountMinor).toBe(0);
    pay(program, "larger");
    program.deliver("larger", "friend-secret", now);
    expect(program.snapshot("owner-secret", now).coupons).toHaveLength(0);
    pay(program, "prior", "another-secret");
    program.reverse("prior", "another-secret");
    expect(() => program.join("another-secret", "OWNER", now)).toThrow("FIRST_ORDER_ONLY");
  });

  it("does not issue a reward when refund arrives before delivery, including reordered repeats", () => {
    const program = setup();
    pay(program);
    program.reverse("order-1", "friend-secret");
    program.deliver("order-1", "friend-secret", now);
    program.reverse("order-1", "friend-secret");
    expect(program.snapshot("owner-secret", now).coupons).toHaveLength(0);
    expect(program.quote("friend-secret", 6600, now).discountMinor).toBe(0);
  });

  it("revokes an unused reward after refund and never restores it on a late delivery event", () => {
    const program = setup(); pay(program); program.deliver("order-1", "friend-secret", now);
    program.reverse("order-1", "friend-secret"); program.deliver("order-1", "friend-secret", now);
    expect(program.snapshot("owner-secret", now).coupons[0].status).toBe("REVOKED");
    expect(program.quote("owner-secret", 6600, now).discountMinor).toBe(0);
  });

  it("flags a spent reward for review after refund instead of inventing a negative balance", () => {
    const program = setup(); pay(program); program.deliver("order-1", "friend-secret", now);
    pay(program, "owners-purchase", "owner-secret");
    program.reverse("order-1", "friend-secret"); program.reverse("order-1", "friend-secret");
    expect(program.snapshot("owner-secret", now)).toMatchObject({ reviewCount: 1, coupons: [{ status: "USED" }] });
  });

  it("caps rewards per Japan calendar month and keeps revoked rewards in the cap", () => {
    const program = setup();
    const before = new Date("2026-09-30T14:59:59Z");
    const after = new Date("2026-09-30T15:00:00Z");
    for (let i = 0; i < REFERRAL_POLICY.monthlyRewardLimit + 2; i++) {
      program.enroll(`friend-${i}`, `INVITE-${i}`); program.join(`friend-${i}`, "OWNER", before);
      pay(program, `order-${i}`, `friend-${i}`, before);
      program.deliver(`order-${i}`, `friend-${i}`, i === 6 ? after : before);
    }
    expect(program.snapshot("owner-secret", after).coupons).toHaveLength(6);
    program.reverse("order-0", "friend-0");
    program.deliver("order-5", "friend-5", after); // A capped purchase isn't queued for another month.
    expect(program.snapshot("owner-secret", after).coupons).toHaveLength(6);
  });

  it("applies one coupon at a time even when the buyer has several rewards", () => {
    const program = setup(); pay(program); program.deliver("order-1", "friend-secret", now);
    program.join("another-secret", "OWNER", now); pay(program, "order-2", "another-secret");
    program.deliver("order-2", "another-secret", now);
    expect(program.snapshot("owner-secret", now).coupons).toHaveLength(2);
    expect(pay(program, "owners-order", "owner-secret").discountMinor).toBe(500);
    expect(program.quote("owner-secret", 6600, now).discountMinor).toBe(500);
  });
});
