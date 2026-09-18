import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PostgresOrderStatusQuery } from "./postgres-order-status-query";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeDatabase() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Isolated local test database required");
  return databaseUrl;
}

(databaseUrl ? describe : describe.skip)("order status first and repeat purchase classification", () => {
  const sql = postgres(safeDatabase(), { max: 2, ssl: false });
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });

  async function customer() {
    const id = randomUUID();
    await sql`INSERT INTO bloombox.customer_accounts (id, status) VALUES (${id}, 'ACTIVE')`;
    return id;
  }

  /** A paid checkout with its order; returns the checkout reference the confirmation page receives. */
  async function checkout(customerId: string | null, createdAt: string, status = "CONFIRMED", withOrder = true) {
    const intentId = randomUUID(), orderId = randomUUID(), buyerId = randomUUID();
    const reference = `cs_test_${intentId.replaceAll("-", "")}`;
    await sql`INSERT INTO bloombox.purchase_intents (id, display_id, status, commerce_provider, external_checkout_id, currency,
      subtotal_minor, delivery_date, pii_key_id, recipient_ciphertext, gift_message_ciphertext, created_at, updated_at, expires_at,
      pii_retention_expires_at, provider_api_version, checkout_created_at, customer_id, customer_version)
      VALUES (${intentId}, ${"PI-" + intentId}, ${withOrder ? "CONVERTED" : "CHECKOUT_CREATED"}, 'STRIPE', ${reference}, 'JPY',
      5000, '2026-10-01', 'test', ${Buffer.from("x")}, ${Buffer.from("x")}, ${createdAt}, ${createdAt}, '2027-01-01', '2027-01-02',
      '2026-07-29.dahlia', ${createdAt}, ${customerId}, ${customerId ? 1 : null})`;
    await sql`INSERT INTO bloombox.purchase_intent_items (id, purchase_intent_id, external_product_id, product_name_snapshot, quantity,
      unit_amount_minor, subtotal_minor, currency, position, catalog_product_id)
      VALUES (${randomUUID()}, ${intentId}, 'fixture', '試験の花', 1, 5000, 5000, 'JPY', 0, 'fixture')`;
    if (!withOrder) return reference;
    await sql`INSERT INTO bloombox.buyers (id, customer_id) VALUES (${buyerId}, ${customerId})`;
    await sql`INSERT INTO bloombox.orders (id, display_id, buyer_id, purchase_intent_id, status, commerce_provider, external_order_id,
      currency, subtotal_minor, tax_minor, shipping_minor, discount_minor, total_minor, created_at, updated_at)
      VALUES (${orderId}, ${"BB-" + orderId}, ${buyerId}, ${intentId}, ${status}, 'STRIPE', ${orderId}, 'JPY', 5000, 0, 1000, 0, 6000,
      ${createdAt}, ${createdAt})`;
    return reference;
  }

  it("distinguishes first, repeat and guest purchases from confirmed earlier orders of the same customer", async () => {
    const query = new PostgresOrderStatusQuery(sql);
    const a = await customer(), b = await customer();
    const cancelled = await checkout(a, "2026-09-01T00:00:00Z", "CANCELLED");
    const first = await checkout(a, "2026-09-02T00:00:00Z");
    const second = await checkout(a, "2026-09-03T00:00:00Z");
    const other = await checkout(b, "2026-09-04T00:00:00Z");
    const guest = await checkout(null, "2026-09-05T00:00:00Z");
    const pending = await checkout(a, "2026-09-06T00:00:00Z", "CONFIRMED", false);

    expect((await query.findByCheckoutReference(cancelled))?.customerPurchase).toBe("FIRST");
    expect((await query.findByCheckoutReference(first))?.customerPurchase).toBe("FIRST");
    expect((await query.findByCheckoutReference(second))?.customerPurchase).toBe("REPEAT");
    expect((await query.findByCheckoutReference(other))?.customerPurchase).toBe("FIRST");
    expect((await query.findByCheckoutReference(guest))?.customerPurchase).toBe("GUEST");
    expect((await query.findByCheckoutReference(pending))?.customerPurchase).toBeUndefined();
  });

  it("reads the classification under the application role", async () => {
    const a = await customer();
    await checkout(a, "2026-09-07T00:00:00Z");
    const repeat = await checkout(a, "2026-09-08T00:00:00Z");
    const connection = postgres(safeDatabase(), { max: 1, ssl: false });
    try {
      await connection`SET ROLE bloombox_application`;
      expect((await new PostgresOrderStatusQuery(connection).findByCheckoutReference(repeat))?.customerPurchase).toBe("REPEAT");
    } finally {
      await connection`RESET ROLE`;
      await connection.end({ timeout: 5 });
    }
  });
});
