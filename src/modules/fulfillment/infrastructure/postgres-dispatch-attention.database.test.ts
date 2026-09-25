import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresDispatchAttention } from "./postgres-dispatch-attention";

const url = process.env.TEST_DATABASE_URL;
if (url && (!["localhost", "127.0.0.1"].includes(new URL(url).hostname) || !new URL(url).pathname.includes("test"))) {
  throw new Error("Isolated local test database required");
}
const suite = url ? describe : describe.skip;

suite("orders awaiting dispatch close to their delivery date", () => {
  const sql = postgres(url ?? "postgres://invalid/test_missing", { max: 5, ssl: false, onnotice: () => {} });
  let worker: postgres.Sql;
  // 2026-09-25 12:00 JST: delivery dates up to 2026-09-27 need an operator now.
  const now = () => new Date("2026-09-25T03:00:00Z");

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
    await sql.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_dispatch_worker') THEN CREATE ROLE test_dispatch_worker LOGIN PASSWORD 'test_only'; END IF; END $$`);
    await sql.unsafe("GRANT bloombox_worker TO test_dispatch_worker");
    const roleUrl = new URL(url ?? "postgres://invalid/test_missing");
    roleUrl.username = "test_dispatch_worker";
    roleUrl.password = "test_only";
    worker = postgres(roleUrl.toString(), { max: 5, ssl: false, onnotice: () => {} });
  });
  beforeEach(async () => {
    await sql`DELETE FROM bloombox.fulfillments`;
    await sql`DELETE FROM bloombox.order_gift_snapshots`;
    await sql`DELETE FROM bloombox.orders`;
  });
  afterAll(async () => { await worker?.end({ timeout: 5 }); await sql.end({ timeout: 5 }); });

  async function order(options: { deliveryDate: string; fulfillment?: string; status?: string; provider?: string }) {
    const id = randomUUID();
    await sql`INSERT INTO bloombox.orders (id, display_id, status, commerce_provider, external_order_id, currency,
      subtotal_minor, tax_minor, shipping_minor, discount_minor, total_minor, created_at, updated_at)
      VALUES (${id}, ${`BB-${id.slice(0, 8)}`}, ${options.status ?? "CONFIRMED"}, ${options.provider ?? "STRIPE"}, ${id}, 'JPY',
        4000, 0, 1000, 0, 5000, clock_timestamp(), clock_timestamp())`;
    await sql`INSERT INTO bloombox.order_gift_snapshots (order_id, delivery_date, pii_key_id, recipient_ciphertext, address_ciphertext, gift_message_ciphertext)
      VALUES (${id}, ${options.deliveryDate}, 'test', ${Buffer.from("recipient")}, ${Buffer.from("address")}, ${Buffer.from("gift")})`;
    await sql`INSERT INTO bloombox.fulfillments (id, order_id, status, created_at, updated_at)
      VALUES (${randomUUID()}, ${id}, ${options.fulfillment ?? "UNFULFILLED"}, clock_timestamp(), clock_timestamp())`;
  }

  it("counts unshipped confirmed orders due within two Tokyo days or overdue, and clears once shipped or cancelled", async () => {
    const attention = new PostgresDispatchAttention(worker, now);
    await expect(attention.count()).resolves.toBe(0);

    // At risk: every unshipped status, on the cutoff, tomorrow, and already past.
    for (const fulfillment of ["UNFULFILLED", "PROCESSING", "READY", "ON_HOLD"]) await order({ deliveryDate: "2026-09-27", fulfillment });
    await order({ deliveryDate: "2026-09-26" });
    await order({ deliveryDate: "2026-09-20", fulfillment: "PROCESSING" });
    // Not at risk: later dates, already with the carrier or ended, not an active native order.
    await order({ deliveryDate: "2026-09-28" });
    for (const fulfillment of ["SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"]) await order({ deliveryDate: "2026-09-26", fulfillment });
    await order({ deliveryDate: "2026-09-26", status: "CANCELLED", fulfillment: "UNFULFILLED" });
    await order({ deliveryDate: "2026-09-26", provider: "SHOPIFY" });

    await expect(attention.count()).resolves.toBe(6);

    await sql`UPDATE bloombox.fulfillments SET status = 'SHIPPED' WHERE status = 'READY'`;
    await sql`UPDATE bloombox.fulfillments SET status = 'CANCELLED' WHERE status = 'ON_HOLD'`;
    await expect(attention.count()).resolves.toBe(4);
  });
});
