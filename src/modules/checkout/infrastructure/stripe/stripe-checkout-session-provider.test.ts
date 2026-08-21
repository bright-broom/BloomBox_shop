import { describe, expect, it, vi } from "vitest";
import { money } from "@/shared/domain/money";
import {
  catalogProductReference,
  commerceProductReference,
  PurchaseIntent,
  purchaseIntentId,
} from "../../domain/purchase-intent";
import { giftMessage, recipientName } from "../../domain/purchase-intent-policy";
import {
  StripeCheckoutSessionProvider,
  StripeCheckoutResponseError,
  StripeSdkCheckoutApi,
  type StripeCheckoutApi,
  type StripeCheckoutSessionsClient,
} from "./stripe-checkout-session-provider";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";

describe("StripeCheckoutSessionProvider", () => {
  it("sends price snapshots and internal references without recipient PII", async () => {
    const create = vi.fn<StripeCheckoutApi["create"]>().mockResolvedValue({
      id: "cs_test_123",
      purchaseIntentId: "12345678-abcd-4000-8000-123456789012",
      url: "https://checkout.stripe.test/session",
      expiresAt: new Date("2026-08-21T23:00:00.000Z"),
    });
    const api: StripeCheckoutApi = {
      create,
      retrieve: vi.fn<StripeCheckoutApi["retrieve"]>(),
    };
    const provider = new StripeCheckoutSessionProvider(api, "2026-07-29.dahlia");

    await provider.create(createIntent(), "stable-idempotency-key");

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      purchaseIntentId: "12345678-abcd-4000-8000-123456789012",
      productId: "prod_haru_01",
      externalProductReference: "gid://shopify/ProductVariant/123",
      productName: "春のひかり",
      quantity: 1,
      unitAmount: 6600,
      currency: "JPY",
      idempotencyKey: "stable-idempotency-key",
    }));
    const serialized = JSON.stringify(create.mock.calls[0][0]);
    expect(serialized).not.toContain("花子");
    expect(serialized).not.toContain("おめでとう");
  });
});

describe("StripeSdkCheckoutApi", () => {
  it("creates a hosted Checkout Session with server-owned tax, terms, shipping, and price", async () => {
    const create = vi.fn<StripeCheckoutSessionsClient["create"]>().mockResolvedValue({
      id: "cs_test_123",
      client_reference_id: "12345678-abcd-4000-8000-123456789012",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      expires_at: 1_787_353_200,
      livemode: false,
    });
    const sessions: StripeCheckoutSessionsClient = {
      create,
      retrieve: vi.fn<StripeCheckoutSessionsClient["retrieve"]>(),
    };
    const api = new StripeSdkCheckoutApi(stripeConfig(), sessions);

    await api.create({
      purchaseIntentId: "12345678-abcd-4000-8000-123456789012",
      productId: "prod_haru_01",
      externalProductReference: "gid://shopify/ProductVariant/123",
      productName: "春のひかり",
      quantity: 2,
      unitAmount: 6600,
      currency: "JPY",
      expiresAt: new Date("2026-08-21T23:00:00.000Z"),
      idempotencyKey: "purchase-intent:123:checkout:v1",
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      mode: "payment",
      locale: "ja",
      submit_type: "pay",
      billing_address_collection: "auto",
      automatic_tax: { enabled: true },
      consent_collection: { terms_of_service: "required" },
      shipping_address_collection: { allowed_countries: ["JP"] },
      shipping_options: [{ shipping_rate: "shr_example" }],
      phone_number_collection: { enabled: true },
      success_url: "https://shop.example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://shop.example.com/cart?checkout=cancelled",
      line_items: [{
        price_data: expect.objectContaining({
          currency: "jpy",
          unit_amount: 6600,
          tax_behavior: "inclusive",
        }),
        quantity: 2,
      }],
    }), { idempotencyKey: "purchase-intent:123:checkout:v1" });
    const serialized = JSON.stringify(create.mock.calls[0]);
    expect(serialized).not.toContain("recipient");
    expect(serialized).not.toContain("giftMessage");
  });

  it("rejects a mismatched mode or unapproved Checkout redirect hostname", async () => {
    const invalidMode: StripeCheckoutSessionsClient = {
      create: vi.fn<StripeCheckoutSessionsClient["create"]>().mockResolvedValue({
        id: "cs_live_123",
        client_reference_id: "12345678-abcd-4000-8000-123456789012",
        url: "https://checkout.stripe.com/c/pay/cs_live_123",
        expires_at: 1_787_353_200,
        livemode: true,
      }),
      retrieve: vi.fn<StripeCheckoutSessionsClient["retrieve"]>(),
    };
    const invalidRedirect: StripeCheckoutSessionsClient = {
      create: vi.fn<StripeCheckoutSessionsClient["create"]>(),
      retrieve: vi.fn<StripeCheckoutSessionsClient["retrieve"]>().mockResolvedValue({
        id: "cs_test_123",
        client_reference_id: "12345678-abcd-4000-8000-123456789012",
        url: "https://attacker.example/cs_test_123",
        expires_at: 1_787_353_200,
        livemode: false,
      }),
    };

    await expect(new StripeSdkCheckoutApi(stripeConfig(), invalidMode).create({
      purchaseIntentId: "12345678-abcd-4000-8000-123456789012",
      productId: "prod_haru_01",
      externalProductReference: "gid://shopify/ProductVariant/123",
      productName: "春のひかり",
      quantity: 1,
      unitAmount: 6600,
      currency: "JPY",
      expiresAt: new Date("2026-08-21T23:00:00.000Z"),
      idempotencyKey: "stable-key",
    })).rejects.toBeInstanceOf(StripeCheckoutResponseError);
    await expect(new StripeSdkCheckoutApi(stripeConfig(), invalidRedirect).retrieve("cs_test_123"))
      .rejects.toBeInstanceOf(StripeCheckoutResponseError);
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

function createIntent(): PurchaseIntent {
  const intent = PurchaseIntent.create({
    id: purchaseIntentId("12345678-abcd-4000-8000-123456789012"),
    displayId: "BBI-20260821-1234",
    item: {
      productId: catalogProductReference("prod_haru_01"),
      externalProductReference: commerceProductReference("gid://shopify/ProductVariant/123"),
      productName: "春のひかり",
      quantity: 1,
      unitPriceSnapshot: money(6600),
      subtotal: money(6600),
    },
    recipient: { name: recipientName("花子"), deliveryDate: "2026-08-28" },
    giftMessage: giftMessage("おめでとう"),
    createdAt: new Date("2026-08-21T00:00:00.000Z"),
  });
  intent.transitionTo("READY_FOR_CHECKOUT");
  return intent;
}
