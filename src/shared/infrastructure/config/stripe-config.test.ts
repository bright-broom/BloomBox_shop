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
  STRIPE_SECRET_KEY: "sk_test_example_only",
  STRIPE_WEBHOOK_SECRET: "whsec_example_only_123",
  STRIPE_ACCOUNT_ID: "acct_example",
  STRIPE_SHIPPING_RATE_ID: "shr_example",
  STRIPE_TAX_BEHAVIOR: "inclusive",
  BLOOMBOX_PUBLIC_ORIGIN: "http://localhost:3000",
} as const;

describe("Stripe configuration", () => {
  it("pins the API version and permits HTTP only for a local test origin", () => {
    expect(loadStripeConfig(validEnvironment)).toMatchObject({
      mode: "test",
      publicOrigin: "http://localhost:3000",
      apiVersion: STRIPE_API_VERSION,
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
