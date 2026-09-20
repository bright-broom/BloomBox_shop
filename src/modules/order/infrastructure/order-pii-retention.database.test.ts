import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresDataRetentionJob } from "@/shared/infrastructure/database/data-retention-job";

const url = process.env.TEST_DATABASE_URL;
if (url && (!["localhost", "127.0.0.1"].includes(new URL(url).hostname) || !new URL(url).pathname.includes("test"))) {
  throw new Error("Isolated local test database required");
}
const suite = url ? describe : describe.skip;

suite("scheduled removal of the gift's personal data from orders", () => {
  const sql = postgres(url ?? "postgres://invalid/test_missing", { max: 5, ssl: false, onnotice: () => {} });
  const now = new Date("2026-12-01T00:00:00.000Z");
  let worker: postgres.Sql;

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
    await sql.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_retention_worker') THEN CREATE ROLE test_retention_worker LOGIN PASSWORD 'test_only'; END IF; END $$`);
    await sql.unsafe("GRANT bloombox_worker TO test_retention_worker");
    const roleUrl = new URL(url ?? "postgres://invalid/test_missing");
    roleUrl.username = "test_retention_worker";
    roleUrl.password = "test_only";
    worker = postgres(roleUrl.toString(), { max: 2, ssl: false, onnotice: () => {} });
  });
  beforeEach(async () => { await sql`TRUNCATE bloombox.orders CASCADE`; });
  afterAll(async () => { await worker?.end({ timeout: 5 }); await sql.end({ timeout: 5 }); });

  async function order(options: { status?: string; retention?: string | null } = {}) {
    const id = randomUUID();
    await sql`INSERT INTO bloombox.orders (id, display_id, status, commerce_provider, external_order_id, currency,
      subtotal_minor, tax_minor, shipping_minor, discount_minor, total_minor, created_at, updated_at)
      VALUES (${id}, ${`BB-${id.slice(0, 8)}`}, ${options.status ?? "CONFIRMED"}, 'STRIPE', ${id}, 'JPY', 4000, 0, 1000, 0, 5000, ${now}, ${now})`;
    await sql`INSERT INTO bloombox.order_gift_snapshots (order_id, delivery_date, pii_key_id, recipient_ciphertext,
      address_ciphertext, gift_message_ciphertext, retention_expires_at)
      VALUES (${id}, '2026-06-01', 'test', ${Buffer.from("recipient")}, ${Buffer.from("address")}, ${Buffer.from("message")},
        ${options.retention === undefined ? "2026-11-30T00:00:00Z" : options.retention})`;
    return id;
  }
  const snapshot = async (id: string) => (await sql`SELECT pii_key_id, recipient_ciphertext, address_ciphertext,
    gift_message_ciphertext, pii_purged_at, delivery_date::text FROM bloombox.order_gift_snapshots WHERE order_id = ${id}`)[0];

  it("removes only the expired gift data, under the worker role, and keeps the order itself", async () => {
    const expired = await order();
    const future = await order({ retention: "2027-06-01T00:00:00Z" });
    const unpaid = await order({ status: "PENDING_CONFIRMATION" });

    const result = await new PostgresDataRetentionJob(worker).execute(now);

    expect(result.orderPiiPurged).toBe(1);
    expect(await snapshot(expired)).toMatchObject({ pii_key_id: null, recipient_ciphertext: null, address_ciphertext: null, gift_message_ciphertext: null, delivery_date: "2026-06-01" });
    expect((await snapshot(expired)).pii_purged_at).toBeTruthy();
    for (const kept of [future, unpaid]) {
      expect((await snapshot(kept)).recipient_ciphertext).not.toBeNull();
      expect((await snapshot(kept)).pii_purged_at).toBeNull();
    }
    const [row] = await sql`SELECT status, total_minor, display_id FROM bloombox.orders WHERE id = ${expired}`;
    expect(row).toMatchObject({ status: "CONFIRMED", total_minor: "5000" });
    const audits = await sql`SELECT action FROM bloombox.audit_logs WHERE resource_id = ${expired}`;
    expect(audits).toEqual([{ action: "order.gift_pii.purged" }]);
  });

  it("is safe to run again and records the removal once", async () => {
    const expired = await order();
    await new PostgresDataRetentionJob(worker).execute(now);
    expect((await new PostgresDataRetentionJob(worker).execute(now)).orderPiiPurged).toBe(0);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${expired}`).toHaveLength(1);
  });

  it("refuses a partial removal that would leave readable personal data behind", async () => {
    const expired = await order();
    await expect(sql`UPDATE bloombox.order_gift_snapshots SET recipient_ciphertext = NULL WHERE order_id = ${expired}`)
      .rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE bloombox.order_gift_snapshots SET pii_purged_at = ${now} WHERE order_id = ${expired}`)
      .rejects.toMatchObject({ code: "23514" });
  });

  it("does not let the worker role change the order's money or state through this grant", async () => {
    const expired = await order();
    await expect(worker`UPDATE bloombox.order_gift_snapshots SET delivery_date = '2027-01-01' WHERE order_id = ${expired}`)
      .rejects.toMatchObject({ code: "42501" });
  });
});
