import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessProviderInbox } from "../application/process-provider-inbox";
import postgres from "postgres";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { ReceiveProviderWebhook, type VerifiedProviderEvent } from "../application/receive-provider-webhook";
import { PostgresWebhookInbox, WebhookInboxPersistenceError, WEBHOOK_MAX_PROCESSING_ATTEMPTS } from "./postgres-webhook-inbox";
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
    expect(await stripeA.claim(claim("stripe-a"))).toMatchObject([{ kind: "READABLE", event: { provider: "STRIPE", providerAccountId: "acct_a" } }]);
    const legacy = new PostgresWebhookInbox(sql, protector);
    expect(await legacy.claim(claim("legacy"))).toMatchObject([{ kind: "READABLE", event: { provider: "STRIPE", providerAccountId: "acct_b" } }]);
    expect(await shop.claim(claim("shop"))).toEqual([{ kind: "READABLE", event }]);
    expect(await otherShop.claim(claim("other"))).toMatchObject([{ kind: "READABLE", event: { provider: "SHOPIFY", providerAccountId: "other.myshopify.com" } }]);
  });
  it("rejects cross-scope writes and prevents the Stripe processor accepting Shopify facts", async () => {
    const other: VerifiedProviderEvent = { ...event, providerAccountId: "other.myshopify.com" };
    await expect(shop.record(other)).rejects.toBeInstanceOf(WebhookInboxPersistenceError);
    await shop.record(event); await shop.claim(claim("worker"));
    const stripe = inbox("STRIPE", config.storeDomain);
    await expect(stripe.markProcessed(event, now, "worker")).rejects.toBeInstanceOf(WebhookInboxPersistenceError);
    await expect(stripe.markFailed(event, "TestError", now, "worker")).rejects.toBeInstanceOf(WebhookInboxPersistenceError);
    await expect(new StripeCommerceEventProcessor(sql, protector, "inclusive").process(event)).rejects.toThrow();
    expect((await sql`SELECT status FROM bloombox.webhook_inbox`)[0].status).toBe("PROCESSING");
  });
  it("recovers stale claims, rejects stale completion, and preserves references through retry", async () => {
    await shop.record(event); expect(await shop.claim(claim("old"))).toEqual([{ kind: "READABLE", event }]);
    expect(await shop.claim(claim("busy"))).toEqual([]);
    const later = new Date(now.getTime() + 301_000);
    expect(await shop.claim(claim("new", later))).toEqual([{ kind: "READABLE", event }]);
    await expect(shop.markProcessed(event, later, "old")).rejects.toBeInstanceOf(WebhookInboxPersistenceError);
    expect(await shop.markFailed(event, "RetryableTestError", later, "new")).toBe("RETRY_SCHEDULED");
    expect(await shop.claim(claim("early", later))).toEqual([]);
    const retryAt = new Date(later.getTime() + 1_001);
    expect(await shop.claim(claim("retry", retryAt))).toEqual([{ kind: "READABLE", event }]);
    await shop.markProcessed(event, retryAt, "retry");
    expect(await shop.record(event)).toBe("DUPLICATE"); expect(await shop.claim(claim("done", retryAt))).toEqual([]);
  });

  it.each(["SHOPIFY", "STRIPE"] as const)("isolates an unreadable %s event while processing its healthy neighbor", async (provider) => {
    const queue = inbox(provider, config.storeDomain);
    const bad = { ...event, provider, externalEventId: "unreadable-event" };
    const good = { ...event, provider, externalEventId: "healthy-event" };
    await queue.record(bad); await queue.record(good);
    await sql`UPDATE bloombox.webhook_inbox SET payload_ciphertext = ${Buffer.from("private-corrupted-payload")} WHERE external_event_id = ${bad.externalEventId}`;
    const processor = { process: vi.fn().mockResolvedValue(undefined) };
    const result = await new ProcessProviderInbox(queue, processor, () => now, () => "isolated-worker").execute();
    expect(result).toEqual({ claimed: 2, processed: 1, retryScheduled: 1, failed: 0 });
    expect(processor.process).toHaveBeenCalledExactlyOnceWith(good);
    const rows = await sql`SELECT external_event_id, status, attempts, last_error_code FROM bloombox.webhook_inbox ORDER BY external_event_id`;
    expect(rows).toEqual([
      { external_event_id: "healthy-event", status: "PROCESSED", attempts: 0, last_error_code: null },
      { external_event_id: "unreadable-event", status: "PENDING", attempts: 1, last_error_code: "ProviderEventUnreadableError" },
    ]);
  });

  it.each(["MALFORMED_JSON", "NON_OBJECT", "PURGED", "MISSING_API_VERSION", "INVALID_TIME", "EMPTY_EVENT_ID"])(
    "records a safe retry for %s instead of creating a partially verified event", async (kind) => {
      await shop.record(event);
      if (kind === "MALFORMED_JSON" || kind === "NON_OBJECT") {
        const payload = protector.protect(kind === "MALFORMED_JSON" ? "private-not-json" : '["private-array"]',
          `webhook:SHOPIFY:${config.storeDomain}:${event.externalEventId}:v1`);
        await sql`UPDATE bloombox.webhook_inbox SET payload_ciphertext = ${payload.ciphertext}`;
      } else if (kind === "PURGED") {
        await sql`UPDATE bloombox.webhook_inbox SET payload_ciphertext = NULL, payload_key_id = NULL, payload_purged_at = ${now}`;
      } else if (kind === "MISSING_API_VERSION") {
        await sql`UPDATE bloombox.webhook_inbox SET api_version = NULL`;
      } else if (kind === "INVALID_TIME") {
        await sql`UPDATE bloombox.webhook_inbox SET provider_occurred_at = 'infinity'::timestamptz`;
      } else {
        await sql`UPDATE bloombox.webhook_inbox SET external_event_id = ''`;
      }
      const before = (await sql`SELECT payload_ciphertext, payload_key_id FROM bloombox.webhook_inbox`)[0];
      const processor = { process: vi.fn() };
      expect(await new ProcessProviderInbox(shop, processor, () => now).execute())
        .toEqual({ claimed: 1, processed: 0, retryScheduled: 1, failed: 0 });
      expect(processor.process).not.toHaveBeenCalled();
      expect((await sql`SELECT status, attempts, last_error_code, payload_ciphertext, payload_key_id FROM bloombox.webhook_inbox`)[0])
        .toEqual({ ...before, status: "PENDING", attempts: 1, last_error_code: "ProviderEventUnreadableError" });
    },
  );

  it("resumes after the missing encryption key is restored without rewriting or duplicating the event", async () => {
    const oldKey = Buffer.alloc(32, 19);
    const oldProtector = new AesGcmDataProtector({ activeKeyId: "previous", keys: new Map([["previous", oldKey]]) });
    const oldWriter = new PostgresWebhookInbox(sql, oldProtector, undefined, () => now, { provider: "SHOPIFY", accountId: config.storeDomain });
    await oldWriter.record(event);
    const processor = { process: vi.fn() };
    expect(await new ProcessProviderInbox(shop, processor, () => now).execute()).toMatchObject({ retryScheduled: 1, processed: 0 });
    const before = (await sql`SELECT payload_ciphertext FROM bloombox.webhook_inbox`)[0];
    const restoredKeys = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 11)], ["previous", oldKey]]) });
    const restored = new PostgresWebhookInbox(sql, restoredKeys, undefined, () => now, { provider: "SHOPIFY", accountId: config.storeDomain });
    const retryAt = new Date(now.getTime() + 1_000);
    expect(await new ProcessProviderInbox(restored, processor, () => retryAt).execute())
      .toEqual({ claimed: 1, processed: 1, retryScheduled: 0, failed: 0 });
    expect(processor.process).toHaveBeenCalledExactlyOnceWith(event);
    expect((await sql`SELECT status, attempts, last_error_code, payload_ciphertext FROM bloombox.webhook_inbox`)[0])
      .toEqual({ ...before, status: "PROCESSED", attempts: 1, last_error_code: null });
    expect(await new ProcessProviderInbox(restored, processor, () => retryAt).execute()).toMatchObject({ claimed: 0 });
  });

  it("bounds repeated restore failures and preserves ciphertext for investigation", async () => {
    await shop.record(event);
    const ciphertext = Buffer.from("private-damaged-payload");
    await sql`UPDATE bloombox.webhook_inbox SET payload_ciphertext = ${ciphertext}`;
    const processor = { process: vi.fn() };
    let clock = now;
    for (let attempt = 1; attempt <= WEBHOOK_MAX_PROCESSING_ATTEMPTS; attempt++) {
      const result = await new ProcessProviderInbox(shop, processor, () => clock).execute();
      expect(result).toEqual({ claimed: 1, processed: 0, retryScheduled: attempt < WEBHOOK_MAX_PROCESSING_ATTEMPTS ? 1 : 0,
        failed: attempt === WEBHOOK_MAX_PROCESSING_ATTEMPTS ? 1 : 0 });
      clock = new Date(clock.getTime() + 3_600_000);
    }
    expect(await new ProcessProviderInbox(shop, processor, () => clock).execute()).toMatchObject({ claimed: 0 });
    expect(processor.process).not.toHaveBeenCalled();
    expect((await sql`SELECT status, attempts, locked_at, locked_by, last_error_code, payload_ciphertext FROM bloombox.webhook_inbox`)[0])
      .toEqual({ status: "FAILED", attempts: WEBHOOK_MAX_PROCESSING_ATTEMPTS, locked_at: null, locked_by: null,
        last_error_code: "ProviderEventUnreadableError", payload_ciphertext: ciphertext });
    expect(await sql`SELECT id FROM bloombox.orders`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.outbox_events`).toHaveLength(0);
  });

  it("recovers an interrupted unreadable claim and refuses failure updates from the old worker", async () => {
    await shop.record(event);
    await sql`UPDATE bloombox.webhook_inbox SET payload_key_id = 'unavailable'`;
    const reference = { provider: event.provider, providerAccountId: event.providerAccountId, externalEventId: event.externalEventId };
    expect(await shop.claim(claim("old"))).toEqual([{ kind: "UNREADABLE", reference }]);
    const later = new Date(now.getTime() + 300_000);
    expect(await shop.claim(claim("replacement", later))).toEqual([{ kind: "UNREADABLE", reference }]);
    await expect(shop.markFailed(reference, "ProviderEventUnreadableError", later, "old")).rejects.toBeInstanceOf(WebhookInboxPersistenceError);
    expect(await shop.markFailed(reference, "ProviderEventUnreadableError", later, "replacement")).toBe("RETRY_SCHEDULED");
    expect((await sql`SELECT attempts FROM bloombox.webhook_inbox`)[0].attempts).toBe(1);
  });

  it("concurrent workers do not double-process healthy events or double-count unreadable failures", async () => {
    await shop.record(event);
    await shop.record({ ...event, externalEventId: "unreadable" });
    await sql`UPDATE bloombox.webhook_inbox SET payload_key_id = 'missing' WHERE external_event_id = 'unreadable'`;
    const processor = { process: vi.fn() };
    const results = await Promise.all(Array.from({ length: 4 }, () => new ProcessProviderInbox(shop, processor, () => now).execute()));
    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(2);
    expect(results.reduce((sum, result) => sum + result.retryScheduled, 0)).toBe(1);
    expect(processor.process).toHaveBeenCalledExactlyOnceWith(event);
  });
});
