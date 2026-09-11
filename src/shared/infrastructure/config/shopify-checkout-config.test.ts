import { describe, expect, it } from "vitest";
import { loadShopifyCheckoutConfig, InvalidShopifyCheckoutConfigurationError } from "./shopify-checkout-config";

const environment = {
  SHOPIFY_STORE_DOMAIN: "bloombox-test.myshopify.com",
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: "isolated-storefront-test-token",
};

describe("Shopify checkout configuration", () => {
  it("defaults to the exact store and permits explicitly configured custom hosts", () => {
    expect(loadShopifyCheckoutConfig(environment).allowedCheckoutHostnames)
      .toEqual([environment.SHOPIFY_STORE_DOMAIN]);
    expect(loadShopifyCheckoutConfig({ ...environment,
      SHOPIFY_CHECKOUT_HOSTNAMES: " Checkout.Example.com ,checkout.example.com",
    }).allowedCheckoutHostnames).toEqual(["checkout.example.com"]);
  });

  it.each(["", "*.shopify.com", "https://example.com", "localhost", "example.com/path", "example.com:443", "user@example.com", "-bad.example.com"])(
    "rejects unsafe checkout host configuration: %s", (hostnames) => {
      expect(() => loadShopifyCheckoutConfig({ ...environment, SHOPIFY_CHECKOUT_HOSTNAMES: hostnames }))
        .toThrow(InvalidShopifyCheckoutConfigurationError);
    },
  );
});
