import { afterEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({
  query: vi.fn(() => { throw new Error("Unexpected database access"); }),
}));
vi.mock("./database/database-connections", () => ({
  getApplicationDatabaseClient: () => query,
  getWorkerDatabaseClient: () => query,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  query.mockClear();
});

describe("production composition during a checkout pause", () => {
  it.each(["false", "invalid"])("keeps settlement services available with intake=%s", async (intake) => {
    const environment = {
      BLOOMBOX_RUNTIME_MODE: "production",
      BLOOMBOX_CHECKOUT_PROVIDER: "stripe",
      BLOOMBOX_CHECKOUT_INTAKE_ENABLED: intake,
      SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: "storefront-token-example",
      BLOOMBOX_PII_KEYRING: JSON.stringify({ activeKeyId: "test", keys: { test: Buffer.alloc(32, 1).toString("base64") } }),
      STRIPE_MODE: "test",
      STRIPE_CHECKOUT_SECRET_KEY: "rk_test_checkout_example",
      STRIPE_RECONCILIATION_SECRET_KEY: "rk_test_reconciliation_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example_only_123",
      STRIPE_ACCOUNT_ID: "acct_example",
      STRIPE_SHIPPING_RATE_ID: "shr_example",
      STRIPE_TAX_BEHAVIOR: "inclusive",
      STRIPE_AUTOMATIC_TAX_ENABLED: "true",
      STRIPE_TERMS_ACCEPTANCE: "required",
      BLOOMBOX_PUBLIC_ORIGIN: "https://example.com",
    };
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected external call"));
    const composition = await import("./composition-root");
    const { CheckoutPausedError } = await import("@/modules/checkout/application/checkout-paused-error");
    const { InvalidCheckoutProviderConfigurationError } = await import("./config/checkout-provider-config");
    await expect(composition.application.preparePurchase.execute({
      requestId: "12345678-abcd-4000-8000-123456789012",
      productId: "prod_haru_01",
      quantity: 1,
      recipientName: "花子",
      deliveryDate: "2026-08-28",
      giftMessage: "おめでとう",
    })).rejects.toBeInstanceOf(intake === "false" ? CheckoutPausedError : InvalidCheckoutProviderConfigurationError);

    expect(composition.getStripeWebhookReceiver().execute).toBeTypeOf("function");
    expect(composition.getStripeInboxProcessor().execute).toBeTypeOf("function");
    expect(composition.getStripeEventReconciler().execute).toBeTypeOf("function");
    expect(composition.getCommerceDataRetentionJob().execute).toBeTypeOf("function");
    expect(query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
