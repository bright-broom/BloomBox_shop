import { describe, expect, it } from "vitest";
import { loadShopifyInboxConfig, InvalidShopifyInboxConfigurationError } from "./shopify-inbox-config";
const configured = { BLOOMBOX_SHOPIFY_INBOX_MODE: "test", BLOOMBOX_RUNTIME_MODE: "production",
  BLOOMBOX_SHOPIFY_ADMIN_MODE: "read", SHOPIFY_STORE_DOMAIN: "test-shop.myshopify.com",
  SHOPIFY_ADMIN_ACCESS_TOKEN: "synthetic-admin-token", SHOPIFY_INBOX_WORKER_SECRET: "synthetic-worker-secret-32-characters" };
describe("Shopify test inbox configuration", () => {
  it("defaults off without credentials", () => {
    expect(loadShopifyInboxConfig({})).toBeNull();
    expect(loadShopifyInboxConfig({ ...configured, BLOOMBOX_SHOPIFY_INBOX_MODE: "disabled" })).toBeNull();
  });
  it("enables only explicit test mode with durable adapters and dedicated credentials", () => {
    expect(loadShopifyInboxConfig(configured)).toEqual({ admin: { storeDomain: configured.SHOPIFY_STORE_DOMAIN,
      accessToken: configured.SHOPIFY_ADMIN_ACCESS_TOKEN, apiVersion: "2026-07" }, workerSecret: configured.SHOPIFY_INBOX_WORKER_SECRET });
  });
  it.each([
    { BLOOMBOX_SHOPIFY_INBOX_MODE: "live" }, { BLOOMBOX_SHOPIFY_INBOX_MODE: "" },
    { BLOOMBOX_RUNTIME_MODE: "preview" }, { BLOOMBOX_RUNTIME_MODE: undefined },
    { SHOPIFY_INBOX_WORKER_SECRET: undefined, COMMERCE_WORKER_SECRET: configured.SHOPIFY_INBOX_WORKER_SECRET },
    { SHOPIFY_INBOX_WORKER_SECRET: "short" }, { SHOPIFY_INBOX_WORKER_SECRET: "x".repeat(257) },
    { SHOPIFY_INBOX_WORKER_SECRET: " ".repeat(32) }, { BLOOMBOX_SHOPIFY_ADMIN_MODE: "disabled" },
  ])("rejects unsafe activation %j", (patch) => {
    expect(() => loadShopifyInboxConfig({ ...configured, ...patch })).toThrow(InvalidShopifyInboxConfigurationError);
  });
  it("requires valid Admin credentials", () => {
    expect(() => loadShopifyInboxConfig({ ...configured, SHOPIFY_ADMIN_ACCESS_TOKEN: "" })).toThrow();
  });
});
