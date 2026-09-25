import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { PostgresNotificationQueue } from "./postgres-notification-queue";

const url = process.env.TEST_DATABASE_URL;
if (url && (!["localhost", "127.0.0.1"].includes(new URL(url).hostname) || !new URL(url).pathname.includes("test"))) {
  throw new Error("Isolated local test database required");
}
const suite = url ? describe : describe.skip;

suite("buyer notification queue on the shared outbox", () => {
  const sql = postgres(url ?? "postgres://invalid/test_missing", { max: 5, ssl: false, onnotice: () => {} });
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 9)]]) });
  let worker: postgres.Sql;
  let queue: PostgresNotificationQueue;

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
    await sql.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_notification_worker') THEN CREATE ROLE test_notification_worker LOGIN PASSWORD 'test_only'; END IF; END $$`);
    await sql.unsafe("GRANT bloombox_worker TO test_notification_worker");
    const roleUrl = new URL(url ?? "postgres://invalid/test_missing");
    roleUrl.username = "test_notification_worker";
    roleUrl.password = "test_only";
    worker = postgres(roleUrl.toString(), { max: 5, ssl: false, onnotice: () => {} });
    queue = new PostgresNotificationQueue(worker, protector);
  });
  beforeEach(async () => {
    await sql`DELETE FROM bloombox.outbox_events`;
  });
  afterAll(async () => { await worker?.end({ timeout: 5 }); await sql.end({ timeout: 5 }); });

  async function order(options: { status?: string; email?: string | null; address?: boolean } = {}) {
    const id = randomUUID();
    await sql`INSERT INTO bloombox.orders (id, display_id, status, commerce_provider, external_order_id, currency,
      subtotal_minor, tax_minor, shipping_minor, discount_minor, total_minor, created_at, updated_at)
      VALUES (${id}, ${`BB-${id.slice(0, 8)}`}, ${options.status ?? "CONFIRMED"}, 'STRIPE', ${id}, 'JPY', 4000, 0, 1000, 0, 5000, clock_timestamp(), clock_timestamp())`;
    await sql`INSERT INTO bloombox.order_items (id, order_id, external_product_id, catalog_product_id, product_name_snapshot, quantity,
      unit_amount_minor, tax_minor, discount_minor, line_total_minor, currency, position)
      VALUES (${randomUUID()}, ${id}, 'native_fixture', 'native_fixture', 'BLOOM BOX M', 1, 4000, 0, 0, 4000, 'JPY', 0)`;
    const address = protector.protect(JSON.stringify({
      customerDetails: { name: "購入者", email: options.email === undefined ? "buyer@example.test" : options.email, phone: "09000000000" },
      collectedInformation: { shipping_details: { name: "受取人", address: { country: "JP", postal_code: "1000001", state: "東京都", city: "千代田区", line1: "1-1" } } },
    }), `order:${id}:address:v1`);
    await sql`INSERT INTO bloombox.order_gift_snapshots (order_id, delivery_date, pii_key_id, recipient_ciphertext, address_ciphertext, gift_message_ciphertext)
      VALUES (${id}, '2026-10-01', 'test', ${Buffer.from("recipient")}, ${options.address === false ? null : address.ciphertext}, ${Buffer.from("gift")})`;
    return id;
  }
  async function event(orderId: string, options: { type?: string; age?: string; attempts?: number; payload?: Record<string, unknown> } = {}) {
    const id = randomUUID();
    await sql`INSERT INTO bloombox.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, attempts, occurred_at, available_at)
      VALUES (${id}, 'Order', ${orderId}, ${options.type ?? "order.confirmed"}, 1,
        ${sql.json((options.payload ?? { orderId, purchaseIntentId: randomUUID(), provider: "STRIPE" }) as postgres.JSONValue)}, ${options.attempts ?? 0},
        clock_timestamp() - ${options.age ?? "1 minute"}::interval, clock_timestamp() - ${options.age ?? "1 minute"}::interval)`;
    return id;
  }
  const row = async (id: string) => (await sql`SELECT status, attempts, locked_by, last_error_code, available_at > clock_timestamp() AS delayed
    FROM bloombox.outbox_events WHERE id = ${id}`)[0];

  it("claims only recent, due notification events once under a lease", async () => {
    const orderId = await order();
    const confirmed = await event(orderId);
    const shipped = await event(orderId, { type: "fulfillment.shipped", payload: { orderId, fulfillmentId: randomUUID(), shipmentId: randomUUID(), carrier: "SAGAWA", trackingNumber: "123456789012" } });
    await event(orderId, { type: "checkout.purchase_intent.ready", payload: { purchaseIntentId: randomUUID() } });
    await event(orderId, { age: "49 hours" });
    await event(orderId, { attempts: 6 });
    const [first, second] = await Promise.all([queue.claim(20), queue.claim(20)]);
    const claimed = [...first, ...second];
    expect(claimed.map((item) => item.eventId).sort()).toEqual([confirmed, shipped].sort());
    expect(claimed.find((item) => item.eventId === shipped)).toMatchObject({ kind: "ORDER_SHIPPED", attempts: 1, shipment: { carrier: "SAGAWA", trackingNumber: "123456789012" } });
    expect(await queue.claim(20)).toHaveLength(0);
  });

  it("reads the buyer's Checkout email and order facts, never the recipient", async () => {
    const orderId = await order();
    await event(orderId);
    const [claimed] = await queue.claim(1);
    const facts = await queue.facts(claimed);
    expect(facts).toEqual({ email: "buyer@example.test", order: { displayId: `BB-${orderId.slice(0, 8)}`, productName: "BLOOM BOX M", quantity: 1, deliveryDate: "2026-10-01", totalYen: 5000 } });
    expect(JSON.stringify(facts)).not.toMatch(/受取人|千代田区|09000000000|gift/);
  });

  it("reports why nothing can be sent without guessing another address", async () => {
    const purged = await order();
    await sql`UPDATE bloombox.order_gift_snapshots SET pii_key_id = NULL, recipient_ciphertext = NULL,
      address_ciphertext = NULL, gift_message_ciphertext = NULL, pii_purged_at = clock_timestamp() WHERE order_id = ${purged}`;
    const cases = [
      [purged, "NO_BUYER_EMAIL"],
      [await order({ email: null }), "NO_BUYER_EMAIL"],
      [await order({ address: false }), "NO_BUYER_EMAIL"],
      [await order({ status: "CANCELLED" }), "ORDER_NOT_ACTIVE"],
      [randomUUID(), "ORDER_NOT_FOUND"],
    ] as const;
    for (const [orderId, reason] of cases) {
      await event(orderId);
      const [claimed] = await queue.claim(1);
      expect(await queue.facts(claimed)).toBe(reason);
      await queue.fail(claimed, reason);
    }
  });

  it("announces an answered request only while the answer is still there", async () => {
    const orderId = await order();
    const requestId = randomUUID(), customerId = randomUUID();
    await sql`INSERT INTO bloombox.customer_accounts (id, status) VALUES (${customerId}, 'ACTIVE')`;
    await sql`INSERT INTO bloombox.customer_requests (id, customer_id, order_id, kind, status, key_id, ciphertext)
      VALUES (${requestId}, ${customerId}, ${orderId}, 'CANCELLATION', 'REPLIED', 'test', ${Buffer.from("PRIVATE ANSWER")})`;
    await event(orderId, { type: "customer.request.replied", payload: { orderId, requestId } });
    const [claimed] = await queue.claim(1);
    expect(claimed).toMatchObject({ kind: "REQUEST_REPLIED", orderId, requestId });
    const facts = await queue.facts(claimed);
    expect(facts).toMatchObject({ email: "buyer@example.test" });
    // The consumer reads no answer text, only that an answer exists.
    expect(JSON.stringify(facts)).not.toMatch(/PRIVATE|ANSWER|受取人/);
    await expect(worker`SELECT ciphertext FROM bloombox.customer_requests WHERE id = ${requestId}`).rejects.toMatchObject({ code: "42501" });
    // A thread closed or reopened before delivery, or an event pointing at another order, is not announced.
    for (const update of [sql`UPDATE bloombox.customer_requests SET status = 'CLOSED' WHERE id = ${requestId}`,
      sql`UPDATE bloombox.customer_requests SET status = 'OPEN' WHERE id = ${requestId}`]) {
      await update;
      await event(orderId, { type: "customer.request.replied", payload: { orderId, requestId } });
      const [pending] = await queue.claim(1);
      expect(await queue.facts(pending)).toBe("REQUEST_NOT_ANSWERED");
      await queue.fail(pending, "REQUEST_NOT_ANSWERED");
    }
    await event(orderId, { type: "customer.request.replied", payload: { orderId, requestId: randomUUID() } });
    const [missing] = await queue.claim(1);
    expect(await queue.facts(missing)).toBe("REQUEST_NOT_ANSWERED");
  });

  it("completes with an audit once, retries later, and fails only under the current lease", async () => {
    const orderId = await order();
    const sent = await event(orderId), later = await event(orderId), dead = await event(orderId);
    const claimed = await queue.claim(3);
    const byId = (id: string) => claimed.find((item) => item.eventId === id)!;
    await queue.complete(byId(sent), "msg_1");
    await queue.complete(byId(sent), "msg_1");
    await queue.retry(byId(later), "SEND_FAILED", 120);
    await queue.fail({ ...byId(dead), lease: "stale-lease" }, "REJECTED");
    expect(await row(sent)).toMatchObject({ status: "PUBLISHED", locked_by: null });
    expect(await row(later)).toMatchObject({ status: "PENDING", locked_by: null, last_error_code: "SEND_FAILED", delayed: true });
    expect(await row(dead)).toMatchObject({ status: "PENDING" });
    await queue.fail(byId(dead), "REJECTED");
    expect(await row(dead)).toMatchObject({ status: "FAILED", last_error_code: "REJECTED" });
    const audits = await sql`SELECT action, safe_metadata FROM bloombox.audit_logs WHERE resource_id = ${orderId}`;
    expect(audits).toEqual([{ action: "notification.order_confirmed.sent", safe_metadata: { eventId: sent, providerMessageId: "msg_1" } }]);
  });

  it("reclaims an abandoned lease after it expires and marks a malformed event failed", async () => {
    const orderId = await order();
    const abandoned = await event(orderId);
    const malformed = await event(orderId, { payload: { orderId: "not-a-uuid" } });
    expect((await queue.claim(5)).map((item) => item.eventId)).toEqual([abandoned]);
    expect(await row(malformed)).toMatchObject({ status: "FAILED", last_error_code: "INVALID_EVENT" });
    await sql`UPDATE bloombox.outbox_events SET locked_at = clock_timestamp() - interval '6 minutes' WHERE id = ${abandoned}`;
    expect(await queue.claim(5)).toMatchObject([{ eventId: abandoned, attempts: 2 }]);
  });
});
