import { describe, expect, it, vi } from "vitest";
import { PurchaseCheckoutClosedError, PurchaseCheckoutCompletedError } from "../../application/start-checkout";
import {
  StripeCheckoutResponseError,
  StripeSdkCheckoutApi,
  type StripeCheckoutSessionsClient,
} from "./stripe-checkout-session-provider";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";

type Resource = Awaited<ReturnType<StripeCheckoutSessionsClient["retrieve"]>>;
const endedSession: Resource = {
  id: "cs_test_123", client_reference_id: "12345678-abcd-4000-8000-123456789012",
  url: null, expires_at: 1_787_353_200, livemode: false, status: "expired",
};

function api(resource: Resource) {
  const sessions: StripeCheckoutSessionsClient = {
    create: vi.fn<StripeCheckoutSessionsClient["create"]>(),
    retrieve: vi.fn<StripeCheckoutSessionsClient["retrieve"]>().mockResolvedValue(resource),
  };
  return new StripeSdkCheckoutApi(stripeConfig(), sessions);
}

describe("StripeSdkCheckoutApi retrieval of an issued session", () => {
  it.each([
    { status: "expired", error: PurchaseCheckoutClosedError },
    { status: "complete", error: PurchaseCheckoutCompletedError },
  ])("reports a $status session as an ended purchase instead of an invalid response", async ({ status, error }) => {
    await expect(api({ ...endedSession, status }).retrieve("cs_test_123")).rejects.toBeInstanceOf(error);
  });

  it("still returns an open session for the customer to continue", async () => {
    await expect(api({ ...endedSession, status: "open", url: "https://checkout.stripe.com/c/pay/cs_test_123" }).retrieve("cs_test_123"))
      .resolves.toMatchObject({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" });
  });

  it.each([
    { livemode: true },
    { id: "cs_test_other" },
    { id: "cs_live_123" },
  ])("rejects an ended session that does not match the stored session or mode: %j", async (overrides) => {
    await expect(api({ ...endedSession, ...overrides }).retrieve("cs_test_123")).rejects.toBeInstanceOf(StripeCheckoutResponseError);
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
