import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(), setCookie: vi.fn(), getProduct: vi.fn(), report: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (key: string) => mocks.jar.has(key) ? { value: mocks.jar.get(key) } : undefined,
  set: (key: string, value: string, options: unknown) => { mocks.jar.set(key, value); mocks.setCookie(key, value, options); },
}) }));
vi.mock("@/shared/infrastructure/composition-root", () => ({ application: { getProduct: { byId: mocks.getProduct } } }));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({ reportUnexpectedError: mocks.report }));

import { quotePreviewReferralAction, settlePreviewReferralAction, simulateReferralOrderAction } from "./preview-referral-actions";
import { readReferralAction, updateReferralAction } from "@/modules/referral/presentation/actions";
import { getPreviewReferralProgram } from "@/shared/infrastructure/referral/preview-referral-runtime";

const input = { requestId: "12345678-abcd-4000-8000-123456789012", productId: "prod_haru_01", quantity: 1 };
const runtime = globalThis as typeof globalThis & { bloomBoxPreviewReferrals?: unknown };

beforeEach(() => {
  vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "preview"); vi.stubEnv("BLOOMBOX_CHECKOUT_PROVIDER", "preview");
  delete runtime.bloomBoxPreviewReferrals;
  mocks.jar.clear(); vi.clearAllMocks();
  mocks.getProduct.mockResolvedValue({ available: true, price: { amount: 6600, currency: "JPY" } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); delete runtime.bloomBoxPreviewReferrals; });

describe("preview referral checkout boundaries", () => {
  it.each([
    ["production", "preview"], ["preview", "stripe"], ["production", "stripe"],
  ])("blocks every action outside an entirely preview environment (%s/%s)", async (mode, provider) => {
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", mode); vi.stubEnv("BLOOMBOX_CHECKOUT_PROVIDER", provider);
    expect((await updateReferralAction({ operation: "enroll" })).error).toBeTruthy();
    expect((await updateReferralAction({ operation: "new_test_member" })).error).toBeTruthy();
    expect((await updateReferralAction({ operation: "switch_test_member" })).error).toBeTruthy();
    expect((await readReferralAction()).error).toBeTruthy();
    expect((await quotePreviewReferralAction(input)).error).toBeTruthy();
    expect((await settlePreviewReferralAction({ ...input, couponId: null, expectedSubtotal: 6600 })).error).toBeTruthy();
    expect((await simulateReferralOrderAction({ requestId: input.requestId, operation: "delivered" })).error).toBeTruthy();
    expect(mocks.setCookie).not.toHaveBeenCalled(); expect(mocks.getProduct).not.toHaveBeenCalled();
  });

  it("runs link issuance, friend claim, server-priced settlement, delivery, reward use and refund review", async () => {
    const owner = await updateReferralAction({ operation: "enroll" });
    const ownerCode = owner.snapshot!.inviteCode;
    const ownerCookie = mocks.jar.get("bloombox_referral_preview");
    expect(mocks.setCookie).toHaveBeenCalledWith("bloombox_referral_preview", expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "lax" }));
    expect(JSON.stringify(owner)).not.toContain(ownerCookie);
    await updateReferralAction({ operation: "new_test_member" });
    expect((await updateReferralAction({ operation: "join", code: ownerCode })).snapshot?.joined).toBe(true);
    const friendCookie = mocks.jar.get("bloombox_referral_preview");
    const result = await quotePreviewReferralAction({ ...input, price: 1, discount: 99999, buyerId: "forged" });
    expect(result.quote).toMatchObject({ subtotalAmount: 6600, discountAmount: 500, tracked: true });
    expect(JSON.stringify(result)).not.toContain(friendCookie);
    const request = { ...input, couponId: result.quote!.couponId, expectedSubtotal: 6600 };
    const paid = await settlePreviewReferralAction(request);
    expect(paid.quote?.discountAmount).toBe(500);
    expect(await settlePreviewReferralAction(request)).toEqual(paid);
    expect((await simulateReferralOrderAction({ requestId: input.requestId, operation: "delivered" })).success).toBe(true);
    await updateReferralAction({ operation: "switch_test_member" });
    expect((await readReferralAction()).snapshot).toMatchObject({ rewardedCount: 1, coupons: [{ status: "AVAILABLE" }] });
    const second = { ...input, requestId: "12345678-abcd-4000-8000-123456789013" };
    const reward = (await quotePreviewReferralAction(second)).quote!;
    expect((await settlePreviewReferralAction({ ...second, couponId: reward.couponId, expectedSubtotal: 6600 })).quote?.discountAmount).toBe(500);
    expect((await simulateReferralOrderAction({ requestId: input.requestId, operation: "refunded" })).error).toBeTruthy();
    await updateReferralAction({ operation: "switch_test_member" });
    await simulateReferralOrderAction({ requestId: input.requestId, operation: "refunded" });
    await updateReferralAction({ operation: "switch_test_member" });
    expect((await readReferralAction()).snapshot?.reviewCount).toBe(1);
    expect(getPreviewReferralProgram().orderCount).toBe(2);
  });

  it("does not consume a coupon when the server price or availability changed", async () => {
    const owner = await updateReferralAction({ operation: "enroll" });
    await updateReferralAction({ operation: "new_test_member" });
    await updateReferralAction({ operation: "join", code: owner.snapshot!.inviteCode });
    const quote = (await quotePreviewReferralAction(input)).quote!;
    mocks.getProduct.mockResolvedValue({ available: true, price: { amount: 7000, currency: "JPY" } });
    expect((await settlePreviewReferralAction({ ...input, couponId: quote.couponId, expectedSubtotal: 6600 })).error).toBeTruthy();
    mocks.getProduct.mockResolvedValue({ available: false, price: { amount: 6600, currency: "JPY" } });
    expect((await settlePreviewReferralAction({ ...input, couponId: quote.couponId, expectedSubtotal: 6600 })).error).toBeTruthy();
    expect((await readReferralAction()).snapshot?.coupons[0].status).toBe("AVAILABLE");
  });

  it("replays an existing order at the storage limit while refusing new orders", async () => {
    await updateReferralAction({ operation: "enroll" });
    const request = { ...input, couponId: null, expectedSubtotal: 6600 };
    const paid = await settlePreviewReferralAction(request);
    expect(paid.quote).toBeDefined();
    vi.spyOn(getPreviewReferralProgram(), "orderCount", "get").mockReturnValue(5000);
    expect(await settlePreviewReferralAction(request)).toEqual(paid);
    expect((await settlePreviewReferralAction({ ...request, requestId: "12345678-abcd-4000-8000-123456789013" })).unavailable).toBe(true);
    await updateReferralAction({ operation: "new_test_member" });
    expect((await settlePreviewReferralAction(request)).error).toBeTruthy();
  });

  it("does not accept malformed quantity or a stolen coupon from another test profile", async () => {
    expect((await quotePreviewReferralAction({ ...input, quantity: 100 })).error).toBeTruthy();
    expect(mocks.getProduct).not.toHaveBeenCalled();
    const owner = await updateReferralAction({ operation: "enroll" });
    await updateReferralAction({ operation: "new_test_member" });
    await updateReferralAction({ operation: "join", code: owner.snapshot!.inviteCode });
    const quote = (await quotePreviewReferralAction(input)).quote!;
    await updateReferralAction({ operation: "switch_test_member" });
    expect((await settlePreviewReferralAction({ ...input, couponId: quote.couponId, expectedSubtotal: 6600 })).error).toBeTruthy();
    expect(getPreviewReferralProgram().orderCount).toBe(0);
  });

  it("treats an unknown cookie as no identity instead of accepting a client-created member", async () => {
    mocks.jar.set("bloombox_referral_preview", "forged");
    expect((await readReferralAction()).snapshot).toBeNull();
    expect((await quotePreviewReferralAction(input)).quote).toMatchObject({ discountAmount: 0, tracked: false });
    expect((await settlePreviewReferralAction({ ...input, couponId: "welcome:forged", expectedSubtotal: 6600 })).error).toBeTruthy();
  });
});
