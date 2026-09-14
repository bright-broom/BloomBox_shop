import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PostgresAdvertisingStore } from "./postgres-advertising-store";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { PostgresAdvertisingPurchaseQuery } from "@/modules/order/infrastructure/postgres-advertising-purchase-query";
const url = process.env.TEST_DATABASE_URL;
function safe() { if (!url) return "postgres://invalid/test_missing"; const u = new URL(url); if (!["127.0.0.1", "localhost"].includes(u.hostname) || !u.pathname.includes("test")) throw new Error("Isolated local test database required"); return url; }
(url ? describe : describe.skip)("advertising durable consent and delivery", () => {
  const sql = postgres(safe(), { max: 4, ssl: false });
  const store = new PostgresAdvertisingStore(sql, new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 7)]]) }));
  const query = new PostgresAdvertisingPurchaseQuery(sql);
  const attribution = { gclid: "private-click", capturedAt: Date.now(), userAgent: "TestBrowser" };
  const destinations = [{ provider: "google" as const, fingerprint: "account" }];
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let i = 0; i < 2; i++) execFileSync("node", ["scripts/migrate-database.mjs"], { env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_MODE: "disable" }, stdio: "pipe" });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });
  async function intent() {
    const id = randomUUID();
    await sql`INSERT INTO bloombox.purchase_intents (id, display_id, status, commerce_provider, external_checkout_id, provider_api_version, checkout_created_at, currency, subtotal_minor, delivery_date, pii_key_id, recipient_ciphertext, gift_message_ciphertext, created_at, updated_at, expires_at, pii_retention_expires_at)
      VALUES (${id}, ${id}, 'CONVERTED', 'STRIPE', ${'cs_live_' + id.replaceAll('-', '')}, 'test-version', now(), 'JPY', 5000, current_date, 'test', ${Buffer.from('encrypted')}, ${Buffer.from('encrypted')}, now(), now(), now() + interval '1 day', now() + interval '30 days')`;
    return id;
  }
  async function paid(intentId: string) {
    const id = randomUUID(); const paymentId = randomUUID();
    await sql`INSERT INTO bloombox.orders (id, display_id, purchase_intent_id, status, commerce_provider, external_order_id, currency, subtotal_minor, tax_minor, shipping_minor, discount_minor, total_minor, confirmed_at, created_at, updated_at)
      VALUES (${id}, ${id}, ${intentId}, 'CONFIRMED', 'STRIPE', ${id}, 'JPY', 5000, 0, 0, 0, 5000, now(), now(), now())`;
    await sql`INSERT INTO bloombox.payments (id, order_id, commerce_provider, external_payment_id, status, amount_requested_minor, amount_authorized_minor, amount_captured_minor, currency, created_at, updated_at)
      VALUES (${paymentId}, ${id}, 'STRIPE', ${paymentId}, 'CAPTURED', 5000, 5000, 5000, 'JPY', now(), now())`;
    return { id, paymentId };
  }
  it("encrypts attribution, deduplicates binding and uses one exclusive delivery lease", async () => {
    const token = await store.grant(attribution); const id = await intent();
    await Promise.all([store.bind(token, id, destinations), store.bind(token, id, destinations)]);
    const rows = await sql`SELECT * FROM bloombox.advertising_consents`;
    expect(JSON.stringify(rows)).not.toContain("private-click");
    const jobs = (await Promise.all([store.claim(), store.claim()])).filter(x => x !== null); expect(jobs).toHaveLength(1);
    expect(await store.attribution(jobs[0])).toEqual(attribution);
    const event = { eventId: `purchase_${randomUUID()}`, occurredAt: new Date().toISOString(), value: 5000, currency: "JPY" as const };
    await store.snapshot(jobs[0], event); await store.finish(jobs[0], "accepted", "receipt");
    expect(await store.claim()).toBeNull();
    await store.revoke(token); expect(await store.active(token)).toBe(false);
    expect((await sql`SELECT attribution_ciphertext FROM bloombox.advertising_consents WHERE revoked_at IS NOT NULL`)[0].attribution_ciphertext).toBeNull();
  });
  it("allows a direct visitor to add the first ad click but never overwrite it", async () => {
    const token = await store.grant({ capturedAt: Date.now(), userAgent: "Browser" }); const id = await intent();
    await store.captureIfEmpty(token, attribution); await store.captureIfEmpty(token, { ...attribution, gclid: "replacement" });
    await store.bind(token, id, destinations); const job = await store.claim(); expect(job).not.toBeNull();
    expect((await store.attribution(job!))?.gclid).toBe("private-click");
    await store.revoke(token); expect(await store.attribution(job!)).toBeNull(); await store.finish(job!, "skipped");
  });
  it("reads only captured live purchase facts, rejecting test checkout, pending, refund and cancellation", async () => {
    const id = await intent(); expect(await query.findConfirmedPurchase(id)).toBeNull();
    const order = await paid(id); expect(await query.findConfirmedPurchase(id)).toMatchObject({ orderId: order.id, value: 5000, currency: "JPY" });
    await sql`UPDATE bloombox.payments SET status = 'PARTIALLY_REFUNDED', amount_refunded_minor = 100 WHERE id = ${order.paymentId}`;
    expect(await query.findConfirmedPurchase(id)).toBeNull();
    await sql`UPDATE bloombox.payments SET status = 'CAPTURED', amount_refunded_minor = 0 WHERE id = ${order.paymentId}`;
    await sql`UPDATE bloombox.orders SET status = 'CANCELLED' WHERE id = ${order.id}`; expect(await query.findConfirmedPurchase(id)).toBeNull();
    const testId = await intent(); await paid(testId);
    await sql`UPDATE bloombox.purchase_intents SET external_checkout_id = ${'cs_test_' + randomUUID().replaceAll('-', '')} WHERE id = ${testId}`;
    expect(await query.findConfirmedPurchase(testId)).toBeNull();
  });
  it("resumes the same snapshot after lease expiry and rejects the previous lease owner", async () => {
    const token = await store.grant(attribution); const id = await intent(); await store.bind(token, id, destinations);
    const first = await store.claim(); expect(first).not.toBeNull();
    const event = { eventId: `purchase_${randomUUID()}`, occurredAt: new Date().toISOString(), value: 5000, currency: "JPY" as const };
    await store.snapshot(first!, event);
    await sql`UPDATE bloombox.advertising_deliveries SET available_at = now() - interval '1 minute' WHERE id = ${first!.id}`;
    const resumed = await store.claim(); expect(resumed?.lease).not.toBe(first!.lease); expect(resumed?.event).toEqual(event);
    await expect(store.snapshot(first!, event)).rejects.toThrow();
    await store.finish(first!, "accepted", "stale");
    expect((await sql`SELECT status FROM bloombox.advertising_deliveries WHERE id = ${first!.id}`)[0].status).toBe("sending");
    await store.finish(resumed!, "accepted", "receipt");
  });
  it("permits the application and worker roles to perform only their advertising operations", async () => {
    const app = postgres(safe(), { max: 1, ssl: false }); const worker = postgres(safe(), { max: 1, ssl: false });
    try {
      await app.unsafe("SET ROLE bloombox_application"); await worker.unsafe("SET ROLE bloombox_worker");
      const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 7)]]) });
      const webStore = new PostgresAdvertisingStore(app, protector); const workerStore = new PostgresAdvertisingStore(worker, protector);
      const token = await webStore.grant(attribution); const id = await intent(); await webStore.bind(token, id, destinations);
      const job = await workerStore.claim(); expect(job).not.toBeNull();
      expect(await workerStore.attribution(job!)).toEqual(attribution);
      expect(await new PostgresAdvertisingPurchaseQuery(worker).findConfirmedPurchase(id)).toBeNull();
      await workerStore.finish(job!, "skipped"); await webStore.revoke(token); await workerStore.clean();
      await expect(app`DELETE FROM bloombox.advertising_consents`).rejects.toThrow();
    } finally { await app.end(); await worker.end(); }
  });
  it("does not backfill a checkout when the first ad click arrives after binding", async () => {
    const token = await store.grant({ capturedAt: Date.now(), userAgent: "Browser" }); const id = await intent();
    await store.bind(token, id, destinations); await store.captureIfEmpty(token, attribution);
    expect((await sql`SELECT count(*)::int AS count FROM bloombox.advertising_deliveries WHERE purchase_intent_id = ${id}`)[0].count).toBe(0);
  });
  it("purges expired attribution and terminates expired jobs without sending", async () => {
    const token = await store.grant(attribution); const id = await intent(); await store.bind(token, id, destinations);
    await sql`UPDATE bloombox.advertising_consents SET expires_at = now() - interval '1 day' WHERE revoked_at IS NULL`;
    await sql`UPDATE bloombox.advertising_deliveries SET expires_at = now() - interval '1 hour', available_at = now() - interval '1 minute' WHERE status = 'pending'`;
    await store.clean(); expect(await store.active(token)).toBe(false); expect(await store.claim()).toBeNull();
    expect((await sql`SELECT count(*)::int AS count FROM bloombox.advertising_consents WHERE attribution_ciphertext IS NOT NULL`)[0].count).toBe(0);
  });
});
