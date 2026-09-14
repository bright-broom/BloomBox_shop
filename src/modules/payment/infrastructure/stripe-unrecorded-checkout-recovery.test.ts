import { describe, expect, it, vi } from "vitest";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";
import {
  decideUnrecordedCheckout,
  MAX_CHECKOUT_SESSIONS_PER_LOOKUP,
  StripeCheckoutLookupLimitError,
  StripeCheckoutLookupResponseError,
  StripeSdkCheckoutSessionFinder,
  type StripeCheckoutSessionList,
} from "./stripe-unrecorded-checkout-recovery";

const purchaseIntentId = "12345678-abcd-4000-8000-123456789012";
const otherPurchaseIntentId = "87654321-abcd-4000-8000-123456789012";

describe("decideUnrecordedCheckout", () => {
  it("releases when Stripe has no session for the purchase", () => {
    expect(decideUnrecordedCheckout([])).toBe("RELEASE");
  });

  it("releases when every session for the purchase ended unpaid", () => {
    expect(decideUnrecordedCheckout([
      { id: "cs_test_1", status: "expired", paymentStatus: "unpaid" },
      { id: "cs_test_2", status: "expired", paymentStatus: "unpaid" },
    ])).toBe("RELEASE");
  });

  it.each([
    { status: "complete", paymentStatus: "paid" },
    { status: "complete", paymentStatus: "unpaid" },
    { status: "open", paymentStatus: "unpaid" },
    { status: "expired", paymentStatus: "paid" },
    { status: null, paymentStatus: "unpaid" },
  ])("never releases automatically when a session is $status and $paymentStatus", (session) => {
    expect(decideUnrecordedCheckout([
      { id: "cs_test_1", status: "expired", paymentStatus: "unpaid" },
      { id: "cs_test_2", ...session },
    ])).toBe("REVIEW");
  });
});

describe("StripeSdkCheckoutSessionFinder", () => {
  function session(overrides: Partial<{ id: string; client_reference_id: string | null; status: string | null; payment_status: string; livemode: boolean }> = {}) {
    return { id: "cs_test_1", client_reference_id: purchaseIntentId, status: "expired", payment_status: "unpaid", livemode: false, ...overrides };
  }
  function listOf(items: ReturnType<typeof session>[]) {
    return vi.fn<StripeCheckoutSessionList>(async function* () { yield* items; });
  }

  it("returns only sessions carrying the purchase reference within the creation window", async () => {
    const list = listOf([
      session({ id: "cs_test_other", client_reference_id: otherPurchaseIntentId, status: "complete", payment_status: "paid" }),
      session({ id: "cs_test_1" }),
      session({ id: "cs_test_none", client_reference_id: null }),
    ]);
    const finder = new StripeSdkCheckoutSessionFinder(stripeConfig(), list);

    const createdFrom = new Date("2026-09-13T00:00:00.400Z"), createdTo = new Date("2026-09-14T00:00:00.400Z");
    await expect(finder.findByPurchaseReference(purchaseIntentId, createdFrom, createdTo))
      .resolves.toEqual([{ id: "cs_test_1", status: "expired", paymentStatus: "unpaid" }]);
    // The window is widened to whole seconds on both sides so a session created at the boundary is never missed.
    expect(list).toHaveBeenCalledExactlyOnceWith({
      createdFrom: Math.floor(createdFrom.getTime() / 1000),
      createdTo: Math.floor(createdTo.getTime() / 1000) + 1,
    });
  });

  it.each([{ livemode: true }, { id: "cs_live_1" }])("rejects a session from the wrong Stripe mode: %j", async (overrides) => {
    const finder = new StripeSdkCheckoutSessionFinder(stripeConfig(), listOf([session(overrides)]));
    await expect(finder.findByPurchaseReference(purchaseIntentId, new Date(0), new Date(1_000)))
      .rejects.toBeInstanceOf(StripeCheckoutLookupResponseError);
  });

  it("stops at a bounded number of scanned sessions instead of reading an unbounded list", async () => {
    const many = Array.from({ length: MAX_CHECKOUT_SESSIONS_PER_LOOKUP + 1 }, (_, index) =>
      session({ id: `cs_test_${index}`, client_reference_id: otherPurchaseIntentId }));
    const finder = new StripeSdkCheckoutSessionFinder(stripeConfig(), listOf(many));
    await expect(finder.findByPurchaseReference(purchaseIntentId, new Date(0), new Date(1_000)))
      .rejects.toBeInstanceOf(StripeCheckoutLookupLimitError);
  });
});

function stripeConfig(): StripeConfig {
  return {
    mode: "test",
    checkoutSecretKey: "rk_test_checkout_example",
    reconciliationSecretKey: "rk_test_reconciliation_example",
    webhookSecret: "whsec_example_only_123",
    accountId: "acct_example",
    shippingRateId: "shr_example",
    taxBehavior: "inclusive",
    automaticTaxEnabled: true,
    termsAcceptance: "required",
    allowedCheckoutHostnames: ["checkout.stripe.com"],
    publicOrigin: "https://shop.example.com",
    apiVersion: "2026-07-29.dahlia",
  };
}
