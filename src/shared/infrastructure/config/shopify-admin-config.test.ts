import { describe, expect, it } from "vitest";
import { InvalidShopifyAdminConfigurationError, loadShopifyAdminConfig } from "./shopify-admin-config";
const valid = { BLOOMBOX_SHOPIFY_ADMIN_MODE: "read", SHOPIFY_STORE_DOMAIN: " BLOOM-TEST.myshopify.com ", SHOPIFY_ADMIN_ACCESS_TOKEN: "isolated-admin-token" };
describe("Shopify Admin read configuration", () => {
  it("stays disabled until read mode is explicit", () => {
    expect(loadShopifyAdminConfig({})).toBeNull();
    expect(loadShopifyAdminConfig({ SHOPIFY_ADMIN_ACCESS_TOKEN: "unused" })).toBeNull();
  });
  it("pins the API version and normalized store domain", () => {
    expect(loadShopifyAdminConfig(valid)).toEqual({ storeDomain: "bloom-test.myshopify.com", accessToken: valid.SHOPIFY_ADMIN_ACCESS_TOKEN, apiVersion: "2026-07" });
  });
  it.each([
    { BLOOMBOX_SHOPIFY_ADMIN_MODE: "live" }, { SHOPIFY_STORE_DOMAIN: "evil.test" },
    { SHOPIFY_STORE_DOMAIN: "bloom.myshopify.com.evil.test" }, { SHOPIFY_ADMIN_ACCESS_TOKEN: undefined },
    { SHOPIFY_ADMIN_ACCESS_TOKEN: "short" }, { SHOPIFY_ADMIN_ACCESS_TOKEN: "token containing whitespace" },
  ])("rejects unsafe configuration with a generic error: %j", (override) => {
    expect(() => loadShopifyAdminConfig({ ...valid, ...override })).toThrow(InvalidShopifyAdminConfigurationError);
  });
});
