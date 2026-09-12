import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PostgresCustomerIdentityRepository } from "./postgres-customer-identity-repository";
import { PostgresCustomerOrderHistory } from "@/modules/order/infrastructure/postgres-customer-order-history";
import { NativeCustomerAccountReader, readCustomerAccount } from "../public";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeDatabase() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Isolated local test database required");
  return databaseUrl;
}
const describeDatabase = databaseUrl ? describe : describe.skip;
describeDatabase("native customer identity and order ownership", () => {
  const sql = postgres(safeDatabase(), { max: 5, ssl: false });
  const identities = new PostgresCustomerIdentityRepository(sql);
  const history = new PostgresCustomerOrderHistory(sql);
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], { env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe" });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });
  it("registers one durable identity and one audit record under concurrent first/repeat logins", async () => {
    const subject = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => identities.registerGoogleSubject(subject)));
    expect(new Set(results.map((row) => row.customerId)).size).toBe(1);
    expect(await identities.registerGoogleSubject(subject)).toEqual(results[0]);
    expect(await identities.isActive(subject, results[0])).toBe(true);
    const audit = await sql`SELECT * FROM bloombox.audit_logs WHERE resource_id = ${results[0].customerId}`;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(subject);
    expect(await sql`SELECT * FROM bloombox.customer_contacts`).toHaveLength(0);
    expect(await sql`SELECT * FROM bloombox.customer_consents`).toHaveLength(0);
  });
  it("rejects another identity, account disable/anonymization and stale session versions without reactivation", async () => {
    const subject = randomUUID(), first = await identities.registerGoogleSubject(subject);
    expect(await identities.isActive(randomUUID(), first)).toBe(false);
    await sql`UPDATE bloombox.customer_accounts SET version = version + 1 WHERE id = ${first.customerId}`;
    expect(await identities.isActive(subject, first)).toBe(false);
    const renewed = await identities.registerGoogleSubject(subject);
    expect(renewed).toEqual({ customerId: first.customerId, version: 2 });
    for (const status of ["DISABLED", "ANONYMIZED"]) {
      await sql`UPDATE bloombox.customer_accounts SET status = ${status} WHERE id = ${first.customerId}`;
      expect(await identities.isActive(subject, renewed)).toBe(false);
      await expect(identities.registerGoogleSubject(subject)).rejects.toThrow("Customer identity unavailable");
    }
  });
  async function order(buyerId: string | null, provider = "STRIPE", createdAt = "2026-09-13T00:00:00.123456Z") {
    const id = randomUUID();
    await sql`INSERT INTO bloombox.orders (id, display_id, buyer_id, status, commerce_provider, external_order_id,
      currency, subtotal_minor, tax_minor, shipping_minor, discount_minor, total_minor, created_at, updated_at)
      VALUES (${id}, ${'BB-' + id}, ${buyerId}, 'CONFIRMED', ${provider}, ${id}, 'JPY', 4000, 0, 1000, 0, 5000, ${createdAt}::text::timestamptz, ${createdAt}::text::timestamptz)`;
    return id;
  }
  async function buyer(customerId: string) {
    const id = randomUUID();
    await sql`INSERT INTO bloombox.buyers (id, customer_id) VALUES (${id}, ${customerId})`;
    return id;
  }
  it("filters by the authenticated buyer, excludes legacy/unlinked/recipient orders and paginates without duplicates", async () => {
    const a = await identities.registerGoogleSubject(randomUUID()), b = await identities.registerGoogleSubject(randomUUID());
    const buyerA = await buyer(a.customerId), buyerB = await buyer(b.customerId);
    const own: string[] = [];
    for (let i = 0; i < 12; i++) own.push(await order(buyerA));
    await order(buyerB); await order(null); await order(buyerA, "SHOPIFY");
    await sql`INSERT INTO bloombox.recipients (id, customer_id) VALUES (${randomUUID()}, ${a.customerId})`;
    const first = await history.read(a.customerId, null);
    const second = await history.read(a.customerId, first.nextCursor);
    expect(first.orders).toHaveLength(10); expect(second.orders).toHaveLength(2); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.orders, ...second.orders].map((row) => row.id))).toEqual(new Set(own));
    expect(first.orders[0]).toMatchObject({ totalYen: 5000, orderedAt: "2026-09-13T00:00:00.123456Z", payment: "UNKNOWN", fulfillment: "UNKNOWN" });
    // Reusing someone else's cursor never changes the customer filter.
    const other = await history.read(b.customerId, first.nextCursor);
    expect(other.orders.every((row) => !own.includes(row.id))).toBe(true);
    const empty = await identities.registerGoogleSubject(randomUUID());
    const reader = new NativeCustomerAccountReader({ ...empty, name: "Google snapshot", email: "same@example.test" }, history);
    expect(await readCustomerAccount(reader, undefined)).toMatchObject({ orders: [], email: "same@example.test" });
    await expect(readCustomerAccount(reader, ["invalid"])).rejects.toThrow();
    await expect(history.read(a.customerId, "malformed")).rejects.toThrow("Customer order history unavailable");
    await expect(history.read("untrusted-customer-id", null)).rejects.toThrow("Customer order history unavailable");
  });
  it("keeps order cancellation, payment and fulfillment separate and does not conceal a mixed state", async () => {
    const a = await identities.registerGoogleSubject(randomUUID()), buyerA = await buyer(a.customerId), id = await order(buyerA);
    await sql`UPDATE bloombox.orders SET status = 'CANCELLED' WHERE id = ${id}`;
    for (const status of ["CAPTURED", "FAILED"]) {
      await sql`INSERT INTO bloombox.payments (id, order_id, commerce_provider, external_payment_id, status, amount_requested_minor, currency, created_at, updated_at)
        VALUES (${randomUUID()}, ${id}, 'STRIPE', ${randomUUID()}, ${status}, 5000, 'JPY', now(), now())`;
    }
    await sql`INSERT INTO bloombox.fulfillments (id, order_id, status, created_at, updated_at) VALUES (${randomUUID()}, ${id}, 'RETURNED', now(), now())`;
    expect((await history.read(a.customerId, null)).orders[0]).toMatchObject({ cancelled: true, payment: "UNKNOWN", fulfillment: "RETURNED" });
    await sql`UPDATE bloombox.orders SET currency = 'USD' WHERE id = ${id}`;
    await expect(history.read(a.customerId, null)).rejects.toThrow("Customer order history unavailable");
  });
  it("supports the existing least-privilege application role and rolls back identity creation when audit insertion fails", async () => {
    const roleConnection = postgres(safeDatabase(), { max: 1, ssl: false });
    try {
      await roleConnection`SET ROLE bloombox_application`;
      const repo = new PostgresCustomerIdentityRepository(roleConnection);
      const identity = await repo.registerGoogleSubject(randomUUID());
      expect((await new PostgresCustomerOrderHistory(roleConnection).read(identity.customerId, null)).orders).toEqual([]);
      await roleConnection`RESET ROLE`;
      await roleConnection`REVOKE INSERT ON bloombox.audit_logs FROM bloombox_application`;
      await roleConnection`SET ROLE bloombox_application`;
      const subject = randomUUID();
      await expect(repo.registerGoogleSubject(subject)).rejects.toThrow("Customer identity unavailable");
      expect(await sql`SELECT * FROM bloombox.customer_identities WHERE provider_subject = ${subject}`).toHaveLength(0);
    } finally {
      await roleConnection`RESET ROLE`;
      await roleConnection`GRANT INSERT ON bloombox.audit_logs TO bloombox_application`;
      await roleConnection.end({ timeout: 5 });
    }
  });
});
