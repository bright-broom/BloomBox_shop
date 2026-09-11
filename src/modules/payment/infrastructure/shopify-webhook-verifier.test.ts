import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidProviderWebhookError } from "../application/receive-provider-webhook";
import { ShopifyWebhookVerifier, type ShopifyWebhookHeaders } from "./shopify-webhook-verifier";

const config = { storeDomain: "bloom-test.myshopify.com", webhookSecret: "test-secret-never-live", apiVersion: "2026-07" } as const;
const verifier = new ShopifyWebhookVerifier(config);
const order = { admin_graphql_api_id: "gid://shopify/Order/9007199254740993", updated_at: "2026-09-11T10:00:00+09:00" };
function signed(raw: Uint8Array, overrides: Partial<ShopifyWebhookHeaders> = {}): ShopifyWebhookHeaders {
  return { signature: createHmac("sha256", config.webhookSecret).update(raw).digest("base64"), shop: config.storeDomain, topic: "orders/paid", apiVersion: config.apiVersion, ...overrides };
}
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("Shopify webhook references", () => {
  it("verifies exact UTF-8 bytes and retains only exact string IDs and timestamps", () => {
    const raw = Buffer.from(` ${JSON.stringify({ ...order, email: "private@example.test", note: "花をありがとう", financial_status: "paid", total_price: "8000.00", id: 9007199254740992 })}\n`);
    const event = verifier.verify(raw, signed(raw));
    expect(event).toMatchObject({ provider: "SHOPIFY", eventType: "shopify.order.changed", externalObjectId: order.admin_graphql_api_id });
    expect(event?.payload).toEqual({ objectType: "shopify_order_reference", id: order.admin_graphql_api_id, sourceOccurredAt: order.updated_at });
    expect(JSON.stringify(event)).not.toMatch(/private|ありがとう|financial_status|total_price/);
    expect(() => verifier.verify(Buffer.from(raw.toString().trim()), signed(raw))).toThrow(InvalidProviderWebhookError);
  });
  it("does not let unsigned topic changes invent a payment or a new identity", () => {
    const raw = bytes(order);
    expect(verifier.verify(raw, signed(raw, { topic: "orders/create" }))).toEqual(verifier.verify(raw, signed(raw)));
  });
  it("retains changed and delayed updates as distinct references", () => {
    const raw = bytes(order); const older = bytes({ ...order, updated_at: "2026-09-10T10:00:00Z" });
    expect(verifier.verify(raw, signed(raw))?.externalEventId).not.toBe(verifier.verify(older, signed(older))?.externalEventId);
  });
  it("captures refund references without converting numeric order IDs", () => {
    const raw = bytes({ admin_graphql_api_id: "gid://shopify/Refund/9007199254740993", created_at: order.updated_at, order_id: 9007199254740992 });
    expect(verifier.verify(raw, signed(raw, { topic: "refunds/create" }))?.payload).toEqual({ objectType: "shopify_refund_reference", id: "gid://shopify/Refund/9007199254740993", sourceOccurredAt: order.updated_at });
  });
  it.each([
    { signature: null }, { signature: "invalid" }, { signature: "A".repeat(43) + "=" },
    { shop: null }, { shop: "other.myshopify.com" }, { apiVersion: "2026-04" }, { topic: null },
  ])("rejects invalid signature or routing headers: %j", (overrides) => {
    const raw = bytes(order);
    expect(() => verifier.verify(raw, signed(raw, overrides))).toThrow(InvalidProviderWebhookError);
  });
  it.each([
    {}, { ...order, admin_graphql_api_id: "gid://shopify/Product/1" },
    { ...order, admin_graphql_api_id: 123 }, { ...order, updated_at: "invalid" },
  ])("rejects malformed references: %j", (body) => {
    const raw = bytes(body);
    expect(() => verifier.verify(raw, signed(raw))).toThrow(InvalidProviderWebhookError);
  });
  it.each([Buffer.from([0xff]), Buffer.from("{"), Buffer.alloc(1_000_001)])("rejects malformed or oversized bytes", (raw) => {
    expect(() => verifier.verify(raw, signed(raw))).toThrow(InvalidProviderWebhookError);
  });
  it("ignores unsupported topics only after signature validation", () => {
    const raw = bytes(order);
    expect(verifier.verify(raw, signed(raw, { topic: "products/update" }))).toBeNull();
    expect(() => verifier.verify(raw, signed(raw, { topic: "products/update", signature: "invalid" }))).toThrow(InvalidProviderWebhookError);
  });
});
