import { describe, expect, it } from "vitest";
import {
  InvalidShopifyStorefrontConfigurationError,
  loadShopifyStorefrontConfig,
} from "./shopify-storefront-config";

describe("loadShopifyStorefrontConfig", () => {
  it("loads a pinned, allowlisted Storefront endpoint", () => {
    expect(loadShopifyStorefrontConfig({
      SHOPIFY_STORE_DOMAIN: "Example-Shop.myshopify.com",
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: "storefront-token-example",
    })).toEqual({
      storeDomain: "example-shop.myshopify.com",
      accessToken: "storefront-token-example",
      catalogTag: "bloombox",
      apiVersion: "2026-07",
    });
  });

  it.each([
    "https://example.myshopify.com",
    "example.com",
    "localhost",
    "example.myshopify.com.attacker.test",
  ])("rejects a non-Shopify endpoint: %s", (storeDomain) => {
    expect(() => loadShopifyStorefrontConfig({
      SHOPIFY_STORE_DOMAIN: storeDomain,
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: "storefront-token-example",
    })).toThrow(InvalidShopifyStorefrontConfigurationError);
  });

  it("requires an access token and a safe catalog tag", () => {
    expect(() => loadShopifyStorefrontConfig({
      SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: "short",
      SHOPIFY_CATALOG_TAG: "tag with spaces",
    })).toThrow(InvalidShopifyStorefrontConfigurationError);
  });
});
