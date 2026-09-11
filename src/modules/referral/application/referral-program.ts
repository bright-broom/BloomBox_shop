import { REFERRAL_POLICY, referralExpiry, referralMonth, ReferralRuleError } from "../domain/referral-policy";

type Member = { id: string; inviteCode: string; inviterId?: string; firstOrderId?: string };
type Coupon = {
  id: string; ownerId: string; kind: "WELCOME" | "THANK_YOU";
  status: "AVAILABLE" | "USED" | "REVOKED"; expiresAt: string; issuedAt: string; usedOrderId?: string;
};
type ReferralOrder = {
  id: string; buyerId: string; subtotalMinor: number; fingerprint: string; couponId: string | null;
  discountMinor: number; inviterId?: string; rewardId?: string;
  state: "PENDING_DELIVERY" | "REWARDED" | "INELIGIBLE" | "LIMIT_REACHED" | "REVOKED" | "REVIEW_REQUIRED";
};

export type ReferralSnapshot = Readonly<{
  inviteCode: string;
  joined: boolean;
  coupons: readonly Readonly<Pick<Coupon, "id" | "kind" | "expiresAt"> & { status: Coupon["status"] | "EXPIRED" }>[];
  pendingCount: number;
  rewardedCount: number;
  reviewCount: number;
}>;

/** In-memory domain model for the preview program. All commands are synchronous,
 * validate before mutation, and perform no I/O. Production requires durable transactions.
 */
export class ReferralProgram {
  private readonly members = new Map<string, Member>();
  private readonly invites = new Map<string, string>();
  private readonly coupons = new Map<string, Coupon>();
  private readonly orders = new Map<string, ReferralOrder>();

  hasMember(id: string): boolean { return this.members.has(id); }
  hasOrder(id: string): boolean { return this.orders.has(id); }
  get size(): number { return this.members.size; }
  get orderCount(): number { return this.orders.size; }

  enroll(id: string, inviteCode: string): void {
    if (this.members.has(id)) return;
    if (!id || !inviteCode || this.invites.has(inviteCode)) throw new ReferralRuleError("ORDER_CONFLICT");
    this.members.set(id, { id, inviteCode });
    this.invites.set(inviteCode, id);
  }

  join(memberId: string, code: string, now: Date): void {
    const member = this.member(memberId);
    const inviterId = this.invites.get(code);
    if (!inviterId) throw new ReferralRuleError("UNKNOWN_INVITE");
    if (inviterId === memberId) throw new ReferralRuleError("SELF_REFERRAL");
    if (member.inviterId && member.inviterId !== inviterId) throw new ReferralRuleError("ALREADY_JOINED");
    if (member.inviterId === inviterId) return; // A repeat claim never extends expiry.
    if (member.firstOrderId) throw new ReferralRuleError("FIRST_ORDER_ONLY");
    member.inviterId = inviterId;
    this.coupons.set(`welcome:${member.inviteCode}`, {
      id: `welcome:${member.inviteCode}`, ownerId: memberId, kind: "WELCOME", status: "AVAILABLE",
      expiresAt: referralExpiry(now), issuedAt: now.toISOString(),
    });
  }

  quote(memberId: string, subtotalMinor: number, now: Date): { couponId: string | null; discountMinor: number } {
    this.member(memberId);
    assertAmount(subtotalMinor);
    if (subtotalMinor < REFERRAL_POLICY.minimumSubtotalMinor) return { couponId: null, discountMinor: 0 };
    const coupon = [...this.coupons.values()]
      .filter((item) => item.ownerId === memberId && item.status === "AVAILABLE" && item.expiresAt > now.toISOString())
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) || a.id.localeCompare(b.id))[0];
    return { couponId: coupon?.id ?? null, discountMinor: coupon ? REFERRAL_POLICY.discountMinor : 0 };
  }

  recordPaidOrder(input: {
    id: string; buyerId: string; subtotalMinor: number; fingerprint: string; couponId: string | null;
  }, now: Date): Readonly<{ discountMinor: number; couponId: string | null }> {
    const buyer = this.member(input.buyerId);
    assertAmount(input.subtotalMinor);
    const existing = this.orders.get(input.id);
    if (existing) {
      if (existing.buyerId !== input.buyerId || existing.subtotalMinor !== input.subtotalMinor
        || existing.fingerprint !== input.fingerprint || existing.couponId !== input.couponId) {
        throw new ReferralRuleError("ORDER_CONFLICT");
      }
      return { discountMinor: existing.discountMinor, couponId: existing.couponId };
    }
    const coupon = input.couponId ? this.coupons.get(input.couponId) : undefined;
    if (input.couponId && (!coupon || coupon.ownerId !== buyer.id || coupon.status !== "AVAILABLE"
      || coupon.expiresAt <= now.toISOString() || input.subtotalMinor < REFERRAL_POLICY.minimumSubtotalMinor
      || (coupon.kind === "WELCOME" && buyer.firstOrderId))) throw new ReferralRuleError("INVALID_COUPON");
    const eligible = !buyer.firstOrderId && buyer.inviterId && input.subtotalMinor >= REFERRAL_POLICY.minimumSubtotalMinor;
    const discountMinor = coupon ? REFERRAL_POLICY.discountMinor : 0;
    const order: ReferralOrder = {
      ...input, discountMinor, inviterId: eligible ? buyer.inviterId : undefined,
      state: eligible ? "PENDING_DELIVERY" : "INELIGIBLE",
    };
    this.orders.set(input.id, order);
    buyer.firstOrderId ??= input.id;
    if (coupon) { coupon.status = "USED"; coupon.usedOrderId = input.id; }
    const welcome = this.coupons.get(`welcome:${buyer.inviteCode}`);
    if (welcome?.status === "AVAILABLE") welcome.status = "REVOKED";
    return { discountMinor, couponId: input.couponId };
  }

  deliver(orderId: string, buyerId: string, now: Date): void {
    const order = this.ownedOrder(orderId, buyerId);
    if (order.state !== "PENDING_DELIVERY" || !order.inviterId) return;
    const issuedThisMonth = [...this.coupons.values()].filter((coupon) =>
      coupon.kind === "THANK_YOU" && coupon.ownerId === order.inviterId
      && referralMonth(new Date(coupon.issuedAt)) === referralMonth(now)).length;
    if (issuedThisMonth >= REFERRAL_POLICY.monthlyRewardLimit) { order.state = "LIMIT_REACHED"; return; }
    const id = `thanks:${order.id}`;
    this.coupons.set(id, {
      id, ownerId: order.inviterId, kind: "THANK_YOU", status: "AVAILABLE",
      issuedAt: now.toISOString(), expiresAt: referralExpiry(now),
    });
    order.rewardId = id;
    order.state = "REWARDED";
  }

  reverse(orderId: string, buyerId: string): void {
    const order = this.ownedOrder(orderId, buyerId);
    if (order.state === "REVOKED" || order.state === "REVIEW_REQUIRED") return;
    const reward = order.rewardId ? this.coupons.get(order.rewardId) : undefined;
    if (reward?.status === "USED") { order.state = "REVIEW_REQUIRED"; return; }
    if (reward) reward.status = "REVOKED";
    order.state = "REVOKED";
    // Refunds do not reopen first-order eligibility or recycle used coupons.
  }

  snapshot(memberId: string, now: Date): ReferralSnapshot {
    const member = this.member(memberId);
    const referred = [...this.orders.values()].filter((order) => order.inviterId === memberId);
    return {
      inviteCode: member.inviteCode, joined: Boolean(member.inviterId),
      coupons: [...this.coupons.values()].filter((coupon) => coupon.ownerId === memberId).map((coupon) => ({
        id: coupon.id, kind: coupon.kind, expiresAt: coupon.expiresAt,
        status: coupon.status === "AVAILABLE" && coupon.expiresAt <= now.toISOString() ? "EXPIRED" : coupon.status,
      })),
      pendingCount: referred.filter((order) => order.state === "PENDING_DELIVERY").length,
      rewardedCount: referred.filter((order) => order.state === "REWARDED").length,
      reviewCount: referred.filter((order) => order.state === "REVIEW_REQUIRED").length,
    };
  }

  private member(id: string): Member {
    const member = this.members.get(id);
    if (!member) throw new ReferralRuleError("NOT_FOUND");
    return member;
  }
  private ownedOrder(id: string, buyerId: string): ReferralOrder {
    const order = this.orders.get(id);
    if (!order || order.buyerId !== buyerId) throw new ReferralRuleError("NOT_FOUND");
    return order;
  }
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ReferralRuleError("INVALID_AMOUNT");
}
