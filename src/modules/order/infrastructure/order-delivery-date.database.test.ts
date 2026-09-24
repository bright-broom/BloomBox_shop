import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withOperatorGrant } from "@/shared/infrastructure/security/operator-auth/native-fulfillment-transaction";
import { ChangeOrderDeliveryDate } from "../application/change-order-delivery-date";
import { OrderDeliveryDateChangeError, ORDER_DELIVERY_DATE_HISTORY_LIMIT, type OrderDeliveryDateCommand } from "../domain/order-delivery-date-change";
import { ORDER_PII_RETENTION_DAYS } from "../domain/order-retention";
import { PostgresOrderDeliveryDateStore } from "./postgres-order-delivery-date";

const url = process.env.TEST_DATABASE_URL;
if (url && (!["localhost", "127.0.0.1"].includes(new URL(url).hostname) || !new URL(url).pathname.includes("test"))) {
  throw new Error("Isolated local test database required");
}
const suite = url ? describe : describe.skip;

suite("operator delivery date changes under least privilege", () => {
  const sql = postgres(url ?? "postgres://invalid/test_missing", { max: 5, ssl: false, onnotice: () => {} });
  const roleUrl = new URL(url ?? "postgres://invalid/test_missing");
  roleUrl.username = "test_delivery_date_operator";
  roleUrl.password = "test_only";
  const staff = postgres(roleUrl.toString(), { max: 5, ssl: false, onnotice: () => {} });
  const actor = { operatorId: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) };
  const window = { earliest: "2026-09-27", latest: "2026-11-23" };
  const confirmedAt = new Date("2026-09-20T02:00:00.000Z");
  const change = (orderId: string, overrides: Partial<OrderDeliveryDateCommand> = {}): OrderDeliveryDateCommand =>
    ({ orderId, requestId: randomUUID(), expectedDate: "2026-10-01", nextDate: "2026-10-08", reason: "購入者からのご相談", ...overrides });
  const grant = {
    reject: (code: "DENIED" | "CONFLICT" | "UNAVAILABLE") => new OrderDeliveryDateChangeError(code),
    expected: (error: unknown) => error instanceof OrderDeliveryDateChangeError,
  };
  const apply = (command: OrderDeliveryDateCommand) =>
    withOperatorGrant(staff, actor, (tx) => new ChangeOrderDeliveryDate(new PostgresOrderDeliveryDateStore(tx)).execute(command, window, actor), grant);
  const code = async (promise: Promise<unknown>) => {
    try { await promise; return "ACCEPTED"; } catch (error) { return error instanceof OrderDeliveryDateChangeError ? error.code : `UNEXPECTED:${String(error)}`; }
  };

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
    await sql.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_delivery_date_operator') THEN CREATE ROLE test_delivery_date_operator LOGIN PASSWORD 'test_only'; END IF; END $$`);
    await sql.unsafe("GRANT bloombox_native_fulfillment TO test_delivery_date_operator");
    await sql`INSERT INTO bloombox.native_fulfillment_operators (operator_id, enabled, valid_until) VALUES (${actor.operatorId}, true, clock_timestamp() + interval '1 hour')`;
  });
  beforeEach(async () => { await sql`TRUNCATE bloombox.orders CASCADE`; });
  afterAll(async () => { await staff.end({ timeout: 5 }); await sql.end({ timeout: 5 }); });

  async function seed(options: { status?: string; provider?: "STRIPE" | "SHOPIFY"; fulfillment?: string | null; shipped?: boolean; purged?: boolean } = {}) {
    const orderId = randomUUID();
    await sql`INSERT INTO bloombox.orders (id, display_id, status, commerce_provider, external_order_id, currency,
      subtotal_minor, tax_minor, shipping_minor, discount_minor, total_minor, confirmed_at, created_at, updated_at)
      VALUES (${orderId}, ${`TEST-${orderId}`}, ${options.status ?? "CONFIRMED"}, ${options.provider ?? "STRIPE"}, ${orderId}, 'JPY',
        4000, 0, 0, 0, 4000, ${confirmedAt}, clock_timestamp(), clock_timestamp())`;
    if (options.purged) {
      await sql`INSERT INTO bloombox.order_gift_snapshots (order_id, delivery_date, retention_expires_at, pii_purged_at)
        VALUES (${orderId}, '2026-10-01', '2027-03-30T00:00:00Z', clock_timestamp())`;
    } else {
      await sql`INSERT INTO bloombox.order_gift_snapshots (order_id, delivery_date, pii_key_id, recipient_ciphertext,
        address_ciphertext, gift_message_ciphertext, retention_expires_at)
        VALUES (${orderId}, '2026-10-01', 'test', ${Buffer.from("PRIVATE RECIPIENT")}, ${Buffer.from("PRIVATE ADDRESS")},
          ${Buffer.from("PRIVATE MESSAGE")}, '2027-03-30T00:00:00Z')`;
    }
    if (options.fulfillment !== null) {
      const fulfillmentId = randomUUID();
      await sql`INSERT INTO bloombox.fulfillments (id, order_id, status, created_at, updated_at)
        VALUES (${fulfillmentId}, ${orderId}, ${options.fulfillment ?? "PROCESSING"}, clock_timestamp(), clock_timestamp())`;
      if (options.shipped) {
        await sql`INSERT INTO bloombox.shipments (id, fulfillment_id, carrier_code, tracking_reference, shipped_at, created_at, updated_at)
          VALUES (${randomUUID()}, ${fulfillmentId}, 'YAMATO', 'TRACK12345678', clock_timestamp(), clock_timestamp(), clock_timestamp())`;
      }
    }
    return orderId;
  }
  const snapshot = async (orderId: string) => {
    const [row] = await sql`SELECT delivery_date::text AS delivery_date, retention_expires_at FROM bloombox.order_gift_snapshots WHERE order_id = ${orderId}`;
    return row;
  };

  it("moves the delivery date with its retention deadline and records the change once", async () => {
    const orderId = await seed();
    await expect(apply(change(orderId))).resolves.toEqual({ orderId, deliveryDate: "2026-10-08", replayed: false });
    const row = await snapshot(orderId);
    expect(row.delivery_date).toBe("2026-10-08");
    expect(new Date(row.retention_expires_at).toISOString())
      .toBe(new Date(Date.parse("2026-10-08T00:00:00Z") + ORDER_PII_RETENTION_DAYS * 86_400_000).toISOString());
    const changes = await sql`SELECT previous_date::text AS previous_date, next_date::text AS next_date, reason, operator_id FROM bloombox.order_delivery_date_changes WHERE order_id = ${orderId}`;
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ previous_date: "2026-10-01", next_date: "2026-10-08", reason: "購入者からのご相談", operator_id: actor.operatorId });
  });

  it("replays the same request without moving the date again", async () => {
    const orderId = await seed();
    const command = change(orderId);
    await expect(apply(command)).resolves.toMatchObject({ replayed: false });
    await expect(apply(command)).resolves.toEqual({ orderId, deliveryDate: "2026-10-08", replayed: true });
    expect((await snapshot(orderId)).delivery_date).toBe("2026-10-08");
    expect(await sql`SELECT id FROM bloombox.order_delivery_date_changes WHERE order_id = ${orderId}`).toHaveLength(1);
    // The same identifier cannot be reused for a different date.
    expect(await code(apply({ ...command, nextDate: "2026-10-09" }))).toBe("CONFLICT");
  });

  it("refuses a change the published terms and the data no longer allow", async () => {
    expect(await code(apply(change(await seed({ shipped: true }))))).toBe("DISPATCHED");
    expect(await code(apply(change(await seed({ fulfillment: "DELIVERED" }))))).toBe("DISPATCHED");
    expect(await code(apply(change(await seed({ status: "CANCELLED" }))))).toBe("ORDER_NOT_ACTIVE");
    expect(await code(apply(change(await seed({ purged: true }))))).toBe("ORDER_NOT_ACTIVE");
    expect(await code(apply(change(await seed({ provider: "SHOPIFY" }))))).toBe("NOT_FOUND");
    expect(await code(apply(change(randomUUID())))).toBe("NOT_FOUND");
    const stale = await seed();
    expect(await code(apply(change(stale, { expectedDate: "2026-09-30" })))).toBe("CONFLICT");
    expect(await code(apply(change(stale, { nextDate: "2026-12-25" })))).toBe("OUT_OF_RANGE");
    expect((await snapshot(stale)).delivery_date).toBe("2026-10-01");
  });

  it("keeps a readable history that holds no personal data", async () => {
    const orderId = await seed();
    await apply(change(orderId));
    await apply(change(orderId, { expectedDate: "2026-10-08", nextDate: "2026-10-15", reason: "再度のご相談" }));
    const history = await withOperatorGrant(staff, actor, (tx) =>
      new PostgresOrderDeliveryDateStore(tx).history(orderId, ORDER_DELIVERY_DATE_HISTORY_LIMIT), grant);
    expect(history.map((entry) => [entry.previousDate, entry.nextDate])).toEqual([["2026-10-08", "2026-10-15"], ["2026-10-01", "2026-10-08"]]);
    expect(JSON.stringify(history)).not.toMatch(/PRIVATE|recipient|address|ciphertext/);
  });

  it("denies the operator connection every write the change does not need", async () => {
    const orderId = await seed();
    await expect(staff`UPDATE bloombox.order_gift_snapshots SET gift_message_ciphertext = ${Buffer.from("tampered")} WHERE order_id = ${orderId}`).rejects.toThrow();
    await expect(staff`DELETE FROM bloombox.order_delivery_date_changes`).rejects.toThrow();
    await expect(staff`UPDATE bloombox.orders SET total_minor = 1 WHERE id = ${orderId}`).rejects.toThrow();
    await expect(staff`SELECT recipient_ciphertext FROM bloombox.order_gift_snapshots WHERE order_id = ${orderId}`).rejects.toThrow();
  });
});
