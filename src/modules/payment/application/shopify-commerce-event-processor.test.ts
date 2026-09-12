import { describe, expect, it, vi } from "vitest";
import { ShopifyCommerceEventProcessor, ShopifyCommerceIncompleteError } from "./shopify-commerce-event-processor";
import { InvalidShopifyReferenceError } from "./read-shopify-reference";
import type { VerifiedProviderEvent } from "./receive-provider-webhook";
const scope = { shop: "test-shop.myshopify.com", apiVersion: "2026-07" };
const event: VerifiedProviderEvent = { provider: "SHOPIFY", providerAccountId: scope.shop, apiVersion: scope.apiVersion,
  eventType: "shopify.order.changed", externalEventId: "synthetic-event", externalObjectId: "gid://shopify/Order/1",
  occurredAt: new Date(), payload: { id: "gid://shopify/Order/1", objectType: "shopify_order_reference" } };
describe("Shopify commerce queue completion", () => {
  it.each([{ provider: "STRIPE" as const }, { providerAccountId: "other.myshopify.com" }, { apiVersion: "2026-04" }])("rejects wrong scope before reconciliation %j", async (patch) => {
    const reconciliation = { execute: vi.fn() };
    await expect(new ShopifyCommerceEventProcessor(reconciliation, scope).process({ ...event, ...patch })).rejects.toThrow(InvalidShopifyReferenceError);
    expect(reconciliation.execute).not.toHaveBeenCalled();
  });
  it.each([
    { acceptance: { outcome: "HELD" }, completion: { outcome: "HELD" } },
    { acceptance: { outcome: "CREATED" }, completion: { outcome: "HELD", reason: "NOT_CONFIGURED" } },
    { acceptance: { outcome: "DUPLICATE" }, completion: { outcome: "COMPLETED", fulfillment: { outcome: "HELD", reason: "NOT_CONFIGURED" } } },
  ])("leaves incomplete local work retryable %j", async (result) => {
    const reconciliation = { execute: vi.fn().mockResolvedValue(result) };
    await expect(new ShopifyCommerceEventProcessor(reconciliation, scope).process(event)).rejects.toThrow(ShopifyCommerceIncompleteError);
  });
  it.each(["APPLIED", "DUPLICATE"])("allows persisted fulfillment decisions including shipping holds: %s", async (outcome) => {
    const reconciliation = { execute: vi.fn().mockResolvedValue({ acceptance: { outcome: "DUPLICATE" },
      completion: { outcome: "COMPLETED", fulfillment: { outcome, decision: "HELD" } } }) };
    await expect(new ShopifyCommerceEventProcessor(reconciliation, scope).process(event)).resolves.toBeUndefined();
    expect(reconciliation.execute).toHaveBeenCalledExactlyOnceWith(event);
  });
  it("propagates failures so existing queue backoff applies", async () => {
    const error = new Error("synthetic dependency failure");
    const reconciliation = { execute: vi.fn().mockRejectedValue(error) };
    await expect(new ShopifyCommerceEventProcessor(reconciliation, scope).process(event)).rejects.toBe(error);
  });
});
