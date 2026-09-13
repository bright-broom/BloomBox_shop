import { PostgresCheckoutBuyerWriter } from "@/modules/customer/infrastructure/postgres-checkout-buyer-writer";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { ReceiveProviderWebhook, type VerifiedProviderEvent } from "../application/receive-provider-webhook";
import { PostgresWebhookInbox, WebhookInboxPersistenceError } from "./postgres-webhook-inbox";
import { ShopifyWebhookVerifier } from "./shopify-webhook-verifier";
import { StripeCommerceEventProcessor } from "./stripe-commerce-event-processor";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeUrl(value: string | undefined): string {
  if (!value) return "postgres://invalid/test_missing";
  const url = new URL(value);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.slice(1).includes("test")) throw new Error("TEST_DATABASE_URL must target a local database whose name contains test");
  return value;
}
const describeDatabase = databaseUrl ? describe : describe.skip;
describeDatabase("Shopify durable webhook capture", () => {
  const sql = postgres(safeUrl(databaseUrl), { max: 4, ssl: false });
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 11)]]) });
  const now = new Date("2026-09-11T00:00:00Z");
  const config = { storeDomain: "bloom-test.myshopify.com", webhookSecret: "isolated-test-secret", apiVersion: "2026-07" } as const;
  const verifier = new ShopifyWebhookVerifier(config);
  const raw = Buffer.from(JSON.stringify({ admin_graphql_api_id: "gid://shopify/Order/9007199254740993", updated_at: now.toISOString(), email: "private@example.test", financial_status: "paid" }));
  const headers = { signature: createHmac("sha256", config.webhookSecret).update(raw).digest("base64"), shop: config.storeDomain, topic: "orders/paid", apiVersion: config.apiVersion };
  const event = verifier.verify(raw, headers)!;
  function inbox(provider: "SHOPIFY" | "STRIPE", accountId: string) {
    return new PostgresWebhookInbox(sql, protector, undefined, () => now, { provider, accountId });
  }
  const shop = inbox("SHOPIFY", config.storeDomain);
  const claim = (workerId: string, at = now) => ({ workerId, now: at, limit: 100, lockTimeoutMinutes: 5 });
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], { env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe" });
  });
  beforeEach(async () => { await sql`DELETE FROM bloombox.webhook_inbox`; });
  afterAll(async () => { await sql.end({ timeout: 5 }); });

  it("deduplicates concurrent delivery and unsigned topic changes without creating commerce state", async () => {
    const receiver = new ReceiveProviderWebhook(verifier, shop);
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => receiver.execute(raw, { ...headers, topic: index % 2 ? "orders/create" : "orders/paid" })));
    expect(results.filter((result) => result === "INSERTED")).toHaveLength(1);
    expect(results.filter((result) => result === "DUPLICATE")).toHaveLength(7);
    const rows = await sql`SELECT payload_ciphertext, payload_key_id, status FROM bloombox.webhook_inbox`;
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe("PENDING");
    expect(rows[0].payload_ciphertext.toString("utf8")).not.toContain(event.externalObjectId);
    const plain = protector.unprotect({ keyId: rows[0].payload_key_id, ciphertext: rows[0].payload_ciphertext }, `webhook:SHOPIFY:${config.storeDomain}:${event.externalEventId}:v1`);
    expect(JSON.parse(plain)).toEqual(event.payload); expect(plain).not.toMatch(/private|financial_status/);
    const counts = await sql`SELECT (SELECT COUNT(*)::int FROM bloombox.orders) AS orders, (SELECT COUNT(*)::int FROM bloombox.payments) AS payments, (SELECT COUNT(*)::int FROM bloombox.fulfillments) AS fulfillments`;
    expect(counts[0]).toEqual({ orders: 0, payments: 0, fulfillments: 0 });
  });
  it("isolates claim queues by provider and account, including the legacy Stripe default", async () => {
    const otherShop = inbox("SHOPIFY", "other.myshopify.com");
    const stripeA = inbox("STRIPE", "acct_a"); const stripeB = inbox("STRIPE", "acct_b");
    await shop.record(event);
    await otherShop.record({ ...event, providerAccountId: "other.myshopify.com" });
    await stripeA.record({ ...event, provider: "STRIPE", providerAccountId: "acct_a" });
    await stripeB.record({ ...event, provider: "STRIPE", providerAccountId: "acct_b" });
    expect(await stripeA.claim(claim("stripe-a"))).toMatchObject([{ provider: "STRIPE", providerAccountId: "acct_a" }]);
    const legacy = new PostgresWebhookInbox(sql, protector);
    expect(await legacy.claim(claim("legacy"))).toMatchObject([{ provider: "STRIPE", providerAccountId: "acct_b" }]);
    expect(await shop.claim(claim("shop"))).toEqual([event]);
    expect(await otherShop.claim(claim("other"))).toMatchObject([{ provider: "SHOPIFY", providerAccountId: "other.myshopify.com" }]);
  });
  it("rejects cross-scope writes and prevents the Stripe processor accepting Shopify facts", async () => {
    const other: VerifiedProviderEvent = { ...event, providerAccountId: "other.myshopify.com" };
    await expect(shop.record(other)).rejects.toBeInstanceOf(WebhookInboxPersistenceError);
    await shop.record(event); await shop.claim(claim("worker"));
    const stripe = inbox("STRIPE", config.storeDomain);
    await expect(stripe.markProcessed(event, now, "worker")).rejects.toBeInstanceOf(WebhookInboxPersistenceError);
    await expect(stripe.markFailed(event, "TestError", now, "worker")).rejects.toBeInstanceOf(WebhookInboxPersistenceError);
    await expect(new StripeCommerceEventProcessor(sql, protector, "inclusive", (tx) => new PostgresCheckoutBuyerWriter(tx)).process(event)).rejects.toThrow();
    expect((await sql`SELECT status FROM bloombox.webhook_inbox`)[0].status).toBe("PROCESSING");
  });
  it("recovers stale claims, rejects stale completion, and preserves references through retry", async () => {
    await shop.record(event); expect(await shop.claim(claim("old"))).toEqual([event]);
    expect(await shop.claim(claim("busy"))).toEqual([]);
    const later = new Date(now.getTime() + 301_000);
    expect(await shop.claim(claim("new", later))).toEqual([event]);
    await expect(shop.markProcessed(event, later, "old")).rejects.toBeInstanceOf(WebhookInboxPersistenceError);
    expect(await shop.markFailed(event, "RetryableTestError", later, "new")).toBe("RETRY_SCHEDULED");
    expect(await shop.claim(claim("early", later))).toEqual([]);
    const retryAt = new Date(later.getTime() + 1_001);
    expect(await shop.claim(claim("retry", retryAt))).toEqual([event]);
    await shop.markProcessed(event, retryAt, "retry");
    expect(await shop.record(event)).toBe("DUPLICATE"); expect(await shop.claim(claim("done", retryAt))).toEqual([]);
  });
});
