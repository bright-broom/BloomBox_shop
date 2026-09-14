import { describe, expect, it, vi } from "vitest";
import { CheckoutPreparationUnavailableError } from "../../application/checkout-session-provider";
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
      validateCreate: vi.fn(),
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
    expect(serialized).not.toContain("00000000-0000-4000-8000-000000000321");
    expect(serialized).not.toContain("customerId");
    expect(serialized).not.toContain("花子");
    expect(serialized).not.toContain("おめでとう");
  });
});

describe("StripeSdkCheckoutApi", () => {
  it.each([{ unitAmount: 4000, shippingAmount: 1000 }, { unitAmount: 8000, shippingAmount: 0 }])("sends the saved one-box quote through the provider to Stripe: %j", async ({ unitAmount, shippingAmount }) => {
    const create = vi.fn<StripeCheckoutSessionsClient["create"]>().mockResolvedValue({
      id: "cs_test_123", client_reference_id: createIntent().id,
      url: "https://checkout.stripe.com/c/pay/cs_test_123", expires_at: 1_787_353_200, livemode: false,
    });
    const api = new StripeSdkCheckoutApi(stripeConfig(), { create, retrieve: vi.fn() });
    const provider = new StripeCheckoutSessionProvider(api, stripeConfig().apiVersion);
    const base = createIntent();
    const intent = PurchaseIntent.create({
      ...base, item: { ...base.item, productId: catalogProductReference("native_12345678-abcd-4000-8000-123456789012"),
        unitPriceSnapshot: money(unitAmount), subtotal: money(unitAmount) }, shippingAmount: money(shippingAmount),
    });
    await provider.create(intent, "same-request");
    await provider.create(intent, "same-request");
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      shipping_options: [{ shipping_rate_data: {
        type: "fixed_amount", display_name: "配送料", fixed_amount: { amount: shippingAmount, currency: "jpy" }, tax_behavior: "inclusive",
      } }],
      line_items: [expect.objectContaining({ quantity: 1, price_data: expect.objectContaining({ unit_amount: unitAmount }) })],
    }), { idempotencyKey: "same-request" });
  });

  it.each([
    { shippingAmount: undefined, quantity: 1, taxBehavior: "inclusive" as const },
    { shippingAmount: -1, quantity: 1, taxBehavior: "inclusive" as const },
    { shippingAmount: 0.5, quantity: 1, taxBehavior: "inclusive" as const },
    { shippingAmount: 1000, quantity: 2, taxBehavior: "inclusive" as const },
    { shippingAmount: 1000, quantity: 1, taxBehavior: "exclusive" as const },
    { shippingAmount: 1000, quantity: 1, taxBehavior: "unspecified" as const },
    { shippingAmount: Number.MAX_SAFE_INTEGER, quantity: 1, taxBehavior: "inclusive" as const },
  ])("refuses an unquoted or incompatible native charge before calling Stripe: %j", async ({ taxBehavior, ...quote }) => {
    const create = vi.fn<StripeCheckoutSessionsClient["create"]>();
    const api = new StripeSdkCheckoutApi({ ...stripeConfig(), taxBehavior }, { create, retrieve: vi.fn() });
    await expect(api.create({
      purchaseIntentId: createIntent().id, productId: "native_12345678-abcd-4000-8000-123456789012",
      externalProductReference: "native_test", productName: "試験商品", unitAmount: 4000, currency: "JPY",
      expiresAt: createIntent().expiresAt, idempotencyKey: "same-request", ...quote,
    })).rejects.toBeInstanceOf(CheckoutPreparationUnavailableError);
    expect(create).not.toHaveBeenCalled();
  });

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
    customer: { customerId: "00000000-0000-4000-8000-000000000321", version: 1 },
  });
  intent.transitionTo("READY_FOR_CHECKOUT");
  return intent;
}
