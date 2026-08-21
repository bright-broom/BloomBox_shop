import { describe, expect, it } from "vitest";
import { loadCheckoutProviderMode } from "./checkout-provider-config";
import {
  InvalidStripeConfigurationError,
  loadStripeConfig,
  STRIPE_API_VERSION,
} from "./stripe-config";
import { InvalidWorkerConfigurationError, loadCommerceWorkerSecret } from "./worker-config";

const validEnvironment = {
  STRIPE_MODE: "test",
  STRIPE_CHECKOUT_SECRET_KEY: "rk_test_checkout_example",
  STRIPE_RECONCILIATION_SECRET_KEY: "rk_test_reconciliation_example",
  STRIPE_WEBHOOK_SECRET: "whsec_example_only_123",
  STRIPE_ACCOUNT_ID: "acct_example",
  STRIPE_SHIPPING_RATE_ID: "shr_example",
  STRIPE_TAX_BEHAVIOR: "inclusive",
  STRIPE_AUTOMATIC_TAX_ENABLED: "true",
  STRIPE_TERMS_ACCEPTANCE: "required",
  BLOOMBOX_PUBLIC_ORIGIN: "http://localhost:3000",
} as const;

describe("Stripe configuration", () => {
  it("pins the API version and permits HTTP only for a local test origin", () => {
    expect(loadStripeConfig(validEnvironment)).toMatchObject({
      mode: "test",
      publicOrigin: "http://localhost:3000",
      automaticTaxEnabled: true,
      termsAcceptance: "required",
      allowedCheckoutHostnames: ["checkout.stripe.com"],
      apiVersion: STRIPE_API_VERSION,
    });
  });

  it("accepts separate restricted keys and one exact custom Checkout hostname", () => {
    expect(loadStripeConfig({
      ...validEnvironment,
      STRIPE_CHECKOUT_CUSTOM_DOMAIN: "pay.example.com",
    })).toMatchObject({
      checkoutSecretKey: "rk_test_checkout_example",
      reconciliationSecretKey: "rk_test_reconciliation_example",
      allowedCheckoutHostnames: ["checkout.stripe.com", "pay.example.com"],
    });
  });

  it("rejects a secret whose mode differs from the configured account", () => {
    expect(() => loadStripeConfig({
      ...validEnvironment,
      STRIPE_MODE: "live",
    })).toThrow(InvalidStripeConfigurationError);
  });

  it("rejects an insecure non-local origin", () => {
    expect(() => loadStripeConfig({
      ...validEnvironment,
      BLOOMBOX_PUBLIC_ORIGIN: "http://example.com",
    })).toThrow(InvalidStripeConfigurationError);
  });

  it("rejects shared credentials and malformed custom domains", () => {
    expect(() => loadStripeConfig({
      ...validEnvironment,
      STRIPE_RECONCILIATION_SECRET_KEY: validEnvironment.STRIPE_CHECKOUT_SECRET_KEY,
    })).toThrow(InvalidStripeConfigurationError);
    expect(() => loadStripeConfig({
      ...validEnvironment,
      STRIPE_CHECKOUT_CUSTOM_DOMAIN: "https://pay.example.com/path",
    })).toThrow(InvalidStripeConfigurationError);
  });

  it("requires automatic tax and price tax behavior to be configured together", () => {
    expect(() => loadStripeConfig({
      ...validEnvironment,
      STRIPE_AUTOMATIC_TAX_ENABLED: "false",
    })).toThrow(InvalidStripeConfigurationError);
    expect(loadStripeConfig({
      ...validEnvironment,
      STRIPE_TAX_BEHAVIOR: "unspecified",
      STRIPE_AUTOMATIC_TAX_ENABLED: "false",
    })).toMatchObject({ automaticTaxEnabled: false, taxBehavior: "unspecified" });
  });

  it("keeps Stripe disabled unless selected explicitly", () => {
    expect(loadCheckoutProviderMode({})).toBe("preview");
    expect(loadCheckoutProviderMode({ BLOOMBOX_CHECKOUT_PROVIDER: "stripe" })).toBe("stripe");
  });
});

describe("commerce worker configuration", () => {
  it("requires a nontrivial secret", () => {
    expect(loadCommerceWorkerSecret({
      COMMERCE_WORKER_SECRET: "a-secure-worker-secret-with-32-chars",
    })).toBe("a-secure-worker-secret-with-32-chars");
    expect(() => loadCommerceWorkerSecret({ COMMERCE_WORKER_SECRET: "short" }))
      .toThrow(InvalidWorkerConfigurationError);
  });
});
