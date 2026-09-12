import { describe, expect, it, vi } from "vitest";
import { ShopifyCommerceEventProcessor, ShopifyCommerceIncompleteError } from "./shopify-commerce-event-processor";
import { InvalidShopifyReferenceError } from "./read-shopify-reference";
import { classifyShopifyCommerceHold } from "./shopify-commerce-hold";
import type { ReconcileShopifyPayment } from "./reconcile-shopify-payment";
import type { VerifiedProviderEvent } from "./receive-provider-webhook";
const scope = { shop: "test-shop.myshopify.com", apiVersion: "2026-07" };
const event: VerifiedProviderEvent = { provider: "SHOPIFY", providerAccountId: scope.shop, apiVersion: scope.apiVersion,
  eventType: "shopify.order.changed", externalEventId: "synthetic-event", externalObjectId: "gid://shopify/Order/1",
  occurredAt: new Date(), payload: { id: "gid://shopify/Order/1", objectType: "shopify_order_reference" } };
type Result = Awaited<ReturnType<ReconcileShopifyPayment["execute"]>>;
const held: Result = { outcome: "APPLIED", status: "CAPTURED", version: 1,
  pricing: { status: "HELD", reason: "MISSING_PRICING" },
  deliveryTiming: { status: "HELD", reason: "PRICING_UNRESOLVED" },
  destination: { status: "HELD", reason: "PREREQUISITES_UNRESOLVED" },
  acceptance: { outcome: "HELD", reason: "PREREQUISITES_UNRESOLVED" },
  completion: { outcome: "HELD", reason: "ORDER_NOT_ACCEPTED" } };
const matched: Result["pricing"] = { status: "MATCHED",
  snapshot: { currency: "JPY", taxesIncluded: true, subtotal: 4000, shipping: 1000, discount: 0,
    additionalTax: 0, includedTax: 454, total: 5000, items: [],
    delivery: { price: 1000, discount: 0, additionalTax: 0, includedTax: 91, total: 1000 } },
  totals: { currency: "JPY", taxesIncluded: true, merchandise: 4000, merchandiseDiscount: 0, shipping: 1000, shippingDiscount: 0, tax: 454, total: 5000 } };
describe("Shopify commerce queue completion", () => {
  it.each([{ provider: "STRIPE" as const }, { providerAccountId: "other.myshopify.com" }, { apiVersion: "2026-04" }])("rejects wrong scope before reconciliation %j", async (patch) => {
    const reconciliation = { execute: vi.fn() };
    await expect(new ShopifyCommerceEventProcessor(reconciliation, scope).process({ ...event, ...patch })).rejects.toThrow(InvalidShopifyReferenceError);
    expect(reconciliation.execute).not.toHaveBeenCalled();
  });
  it.each([
    { acceptance: { outcome: "HELD", reason: "PREREQUISITES_UNRESOLVED" }, completion: { outcome: "HELD" } },
    { acceptance: { outcome: "CREATED" }, completion: { outcome: "HELD", reason: "NOT_CONFIGURED" } },
    { acceptance: { outcome: "DUPLICATE" }, completion: { outcome: "COMPLETED", fulfillment: { outcome: "HELD", reason: "NOT_CONFIGURED" } } },
  ])("leaves incomplete local work retryable %j", async (result) => {
    const reconciliation = { execute: vi.fn().mockResolvedValue({ ...held, ...result }) };
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

describe("operator-facing hold classification", () => {
  it.each([
    ["NOT_CONFIGURED", "CONFIGURATION"], ["TERMS_NOT_APPROVED", "TERMS"], ["TERMS_MISMATCH", "TERMS"],
    ["PRICING_UNRESOLVED", "PRICING"], ["DISCOUNTS_UNSUPPORTED", "PRICING"], ["PAYMENT_UNSETTLED", "PAYMENT"],
    ["ADDRESS_UNRESOLVED", "DELIVERY"], ["DELIVERY_UNAVAILABLE", "DELIVERY"],
    ["ORDER_CHANGED", "ORDER"], ["SHIPPING_NOT_REQUIRED", "ORDER"], ["STALE_PAYMENT", "ORDER"], ["PURCHASE_UNAVAILABLE", "ORDER"],
  ] as const)("maps explicit acceptance hold %s without inferring a later stage", (reason, category) => {
    expect(classifyShopifyCommerceHold({ ...held, acceptance: { outcome: "HELD", reason } })).toBe(category);
  });
  it("prioritizes stale/cancelled source and payment before downstream pricing or address holds", () => {
    expect(classifyShopifyCommerceHold({ ...held, outcome: "STALE" })).toBe("ORDER");
    expect(classifyShopifyCommerceHold({ ...held, status: "REFUNDED", deliveryTiming: { status: "HELD", reason: "ORDER_CANCELLED" } })).toBe("ORDER");
    expect(classifyShopifyCommerceHold({ ...held, status: "PROCESSING" })).toBe("PAYMENT");
    expect(classifyShopifyCommerceHold({ ...held, deliveryTiming: { status: "HELD", reason: "PAYMENT_PENDING" } })).toBe("PAYMENT");
    expect(classifyShopifyCommerceHold(held)).toBe("PRICING");
  });
  it("distinguishes purchase availability from delivery problems after pricing passes", () => {
    expect(classifyShopifyCommerceHold({ ...held, pricing: matched, deliveryTiming: { status: "HELD", reason: "PURCHASE_DETAILS_UNAVAILABLE" } })).toBe("ORDER");
    expect(classifyShopifyCommerceHold({ ...held, pricing: matched, deliveryTiming: { status: "HELD", reason: "INSUFFICIENT_LEAD_TIME" } })).toBe("DELIVERY");
    expect(classifyShopifyCommerceHold({ ...held, pricing: matched, deliveryTiming: { status: "WITHIN_WINDOW", deliveryDate: "2026-09-20" },
      destination: { status: "HELD", reason: "POSTAL_CODE_INVALID" } })).toBe("DELIVERY");
  });
  it("retains a generic category when no assessed prerequisite explains acceptance", () => {
    expect(classifyShopifyCommerceHold({ ...held, pricing: matched, deliveryTiming: { status: "WITHIN_WINDOW", deliveryDate: "2026-09-20" },
      destination: { status: "STRUCTURALLY_VALID_AND_COVERED" } })).toBe("INCOMPLETE");
  });
});
