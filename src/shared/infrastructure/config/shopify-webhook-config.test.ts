import { describe, expect, it } from "vitest";
import { InvalidShopifyWebhookConfigurationError, loadShopifyWebhookConfig } from "./shopify-webhook-config";

const valid = { BLOOMBOX_SHOPIFY_WEBHOOK_MODE: "capture", SHOPIFY_STORE_DOMAIN: " Bloom-Test.myshopify.com ", SHOPIFY_WEBHOOK_SECRET: "isolated-test-secret" };
describe("Shopify webhook configuration", () => {
  it("defaults to disabled even when unused credentials exist", () => {
    expect(loadShopifyWebhookConfig({})).toBeNull();
    expect(loadShopifyWebhookConfig({ SHOPIFY_WEBHOOK_SECRET: "unused" })).toBeNull();
  });
  it("pins a validated shop and API version for explicit capture", () => {
    expect(loadShopifyWebhookConfig(valid)).toEqual({ storeDomain: "bloom-test.myshopify.com", webhookSecret: valid.SHOPIFY_WEBHOOK_SECRET, apiVersion: "2026-07" });
  });
  it.each([
    { BLOOMBOX_SHOPIFY_WEBHOOK_MODE: "live" }, { SHOPIFY_STORE_DOMAIN: "https://bloom.myshopify.com" },
    { SHOPIFY_STORE_DOMAIN: "bloom.myshopify.com.evil.test" }, { SHOPIFY_WEBHOOK_SECRET: "short" }, { SHOPIFY_WEBHOOK_SECRET: undefined },
  ])("rejects invalid configuration without exposing it: %j", (override) => {
    expect(() => loadShopifyWebhookConfig({ ...valid, ...override })).toThrow(InvalidShopifyWebhookConfigurationError);
    expect(() => loadShopifyWebhookConfig({ ...valid, ...override })).toThrow("Shopify webhook configuration is invalid");
  });
});
