import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { CreatePurchaseIntent } from "../application/create-purchase-intent";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import { PostgresPurchaseIntentRepository } from "./postgres-purchase-intent-repository";
import { PostgresCustomerIdentityRepository } from "@/modules/customer/infrastructure/postgres-customer-identity-repository";
import { PostgresCheckoutBuyerWriter } from "@/modules/customer/infrastructure/postgres-checkout-buyer-writer";
import { PostgresCustomerOrderHistory } from "@/modules/order/infrastructure/postgres-customer-order-history";
import { StripeCommerceEventProcessor } from "@/modules/payment/infrastructure/stripe-commerce-event-processor";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import type { PurchaseCustomer } from "../domain/purchase-customer";
import type { PurchaseIntent } from "../domain/purchase-intent";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeDatabase() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Isolated local test database required");
  return databaseUrl;
}
const describeDatabase = databaseUrl ? describe : describe.skip;
const now = () => new Date("2026-09-13T00:00:00Z");
const input = () => ({ requestId: randomUUID(), productId: "prod_bloombox_m", quantity: 1, recipientName: "試験用受取人", deliveryDate: "2026-09-20", giftMessage: "試験用メッセージ" });

describeDatabase("durable purchase customer and paid-order ownership", () => {
  const sql = postgres(safeDatabase(), { max: 5, ssl: false });
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 8)]]) });
  const repository = new PostgresPurchaseIntentRepository(sql, protector);
  const identities = new PostgresCustomerIdentityRepository(sql);
  const history = new PostgresCustomerOrderHistory(sql);
  const processor = new StripeCommerceEventProcessor(sql, protector, "inclusive", (tx) => new PostgresCheckoutBuyerWriter(tx));
  const create = (customer: PurchaseCustomer | null, storage = repository) => new CreatePurchaseIntent(new InMemoryProductRepository(), storage, now, () => true, async () => customer);
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let i = 0; i < 2; i++) execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });

  async function customer() { return identities.registerGoogleSubject(randomUUID()); }
  async function paidEvent(intent: PurchaseIntent) {
    const checkoutId = `cs_test_${intent.id}`, paymentId = `pi_test_${intent.id}`;
    intent.recordCheckoutCreated({ provider: "STRIPE", externalCheckoutId: checkoutId, providerApiVersion: "test", occurredAt: now() });
    await repository.saveCheckoutCreated(intent);
    return {
      provider: "STRIPE" as const, providerAccountId: "acct_example", externalEventId: `evt_${intent.id}`,
      eventType: "checkout.session.completed", externalObjectId: checkoutId, apiVersion: "test", occurredAt: now(),
      payload: { objectType: "checkout_session", id: checkoutId, purchaseIntentId: intent.id, paymentIntentId: paymentId,
        paymentStatus: "paid", checkoutStatus: "complete", amountTotal: 5000, amountSubtotal: 4000, currency: "jpy",
        totalDetails: { amount_discount: 0, amount_shipping: 1000, amount_tax: 0 }, customerId: "cus_untrusted_identity",
        customerDetails: { email: "same-email@example.test" }, collectedInformation: { shipping_details: { name: "別の受取人" } } },
    };
  }

  it("preserves one customer and one ready event under concurrent repeated submissions, refusing other-account and guest replays", async () => {
    const a = await customer(), b = await customer(), request = input();
    const results = await Promise.all(Array.from({ length: 5 }, () => create(a).execute(request)));
    expect(results.every((row) => row.customer?.customerId === a.customerId)).toBe(true);
    expect((await repository.findById(results[0].id))?.customer).toEqual(a);
    expect(await sql`SELECT id FROM bloombox.outbox_events WHERE aggregate_id = ${request.requestId}`).toHaveLength(1);
    await expect(create(b).execute(request)).rejects.toThrow("ログイン状態");
    await expect(create(null).execute(request)).rejects.toThrow("ログイン状態");
    const guestRequest = input(); await create(null).execute(guestRequest);
    await expect(create(a).execute(guestRequest)).rejects.toThrow("ログイン状態");
  });

  it("allows only one owner when two accounts race with the same purchase request ID", async () => {
    const a = await customer(), b = await customer(), request = input();
    const results = await Promise.allSettled([create(a).execute(request), create(b).execute(request)]);
    const success = results.find((row) => row.status === "fulfilled");
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
    if (success?.status !== "fulfilled") throw new Error("Expected one accepted intent");
    const stored = await repository.findById(success.value.id);
    expect(stored?.customer).toEqual(success.value.customer);
    expect(await sql`SELECT id FROM bloombox.outbox_events WHERE aggregate_id = ${request.requestId}`).toHaveLength(1);
  });

  it("rejects a stale or disabled identity at the atomic save boundary without partial rows", async () => {
    const a = await customer();
    await sql`UPDATE bloombox.customer_accounts SET version = version + 1 WHERE id = ${a.customerId}`;
    for (const actor of [a, { ...a, version: 2 }]) {
      if (actor.version === 2) await sql`UPDATE bloombox.customer_accounts SET status = 'DISABLED' WHERE id = ${a.customerId}`;
      const request = input();
      await expect(create(actor).execute(request)).rejects.toThrow("could not be persisted");
      expect(await sql`SELECT id FROM bloombox.purchase_intents WHERE id = ${request.requestId}`).toHaveLength(0);
      expect(await sql`SELECT id FROM bloombox.outbox_events WHERE aggregate_id = ${request.requestId}`).toHaveLength(0);
    }
  });

  it("carries the stored owner into one paid order and only that customer's history despite conflicting provider identity", async () => {
    const a = await customer(), b = await customer();
    const intent = await create(a).execute(input());
    const event = await paidEvent(intent);
    event.payload.customerDetails = { email: "recipient-or-other-customer@example.test" };
    await Promise.all([processor.process(event), processor.process(event), processor.process(event)]);
    const orders = await history.read(a.customerId, null);
    expect(orders.orders).toHaveLength(1);
    expect(orders.orders[0]).toMatchObject({ totalYen: 5000, payment: "CAPTURED", fulfillment: "UNFULFILLED" });
    expect((await history.read(b.customerId, null)).orders).toEqual([]);
    const rows = await sql`SELECT buyer.customer_id, orders.buyer_id FROM bloombox.orders orders
      JOIN bloombox.buyers buyer ON buyer.id = orders.buyer_id WHERE purchase_intent_id = ${intent.id}`;
    expect(rows).toHaveLength(1); expect(rows[0].customer_id).toBe(a.customerId);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${rows[0].buyer_id}`).toHaveLength(1);
    expect(await sql`SELECT id FROM bloombox.recipients WHERE customer_id IS NOT NULL`).toHaveLength(0);
    const ready = await sql`SELECT payload FROM bloombox.outbox_events WHERE aggregate_id = ${intent.id}`;
    expect(JSON.stringify(ready)).not.toContain(a.customerId);
  });

  it("settles after logout/revocation/account disable while private history remains unavailable for the disabled account", async () => {
    const a = await customer(), intent = await create(a).execute(input()), event = await paidEvent(intent);
    await sql`UPDATE bloombox.customer_accounts SET status = 'DISABLED', version = version + 1 WHERE id = ${a.customerId}`;
    await processor.process(event);
    const rows = await sql`SELECT buyer.customer_id FROM bloombox.orders orders JOIN bloombox.buyers buyer ON buyer.id = orders.buyer_id
      WHERE purchase_intent_id = ${intent.id}`;
    expect(rows[0].customer_id).toBe(a.customerId);
    expect((await history.read(a.customerId, null)).orders).toEqual([]);
  });

  it("does not attach guest orders even when provider email and customer metadata look like a registered account", async () => {
    const a = await customer(), intent = await create(null).execute(input());
    await processor.process(await paidEvent(intent));
    const rows = await sql`SELECT buyer.customer_id FROM bloombox.orders orders JOIN bloombox.buyers buyer ON buyer.id = orders.buyer_id
      WHERE purchase_intent_id = ${intent.id}`;
    expect(rows[0].customer_id).toBeNull();
    expect((await history.read(a.customerId, null)).orders).toEqual([]);
  });

  it("uses existing application/worker grants and rolls buyer, order and audit back if payment persistence fails", async () => {
    const a = await customer(), connection = postgres(safeDatabase(), { max: 1, ssl: false });
    const storage = new PostgresPurchaseIntentRepository(connection, protector);
    try {
      await connection`SET ROLE bloombox_application`;
      const intent = await create(a, storage).execute(input());
      const event = await paidEvent(intent);
      await connection`RESET ROLE`;
      await connection`REVOKE INSERT ON bloombox.payments FROM bloombox_worker`;
      await connection`SET ROLE bloombox_worker`;
      const worker = new StripeCommerceEventProcessor(connection, protector, "inclusive", (tx) => new PostgresCheckoutBuyerWriter(tx));
      await expect(worker.process(event)).rejects.toThrow();
      expect(await sql`SELECT id FROM bloombox.buyers WHERE customer_id = ${a.customerId}`).toHaveLength(0);
      expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${intent.id}`).toHaveLength(0);
      expect((await repository.findById(intent.id))?.status).toBe("CHECKOUT_CREATED");
      await connection`RESET ROLE`; await connection`GRANT INSERT ON bloombox.payments TO bloombox_worker`;
      await connection`SET ROLE bloombox_worker`;
      await worker.process(event);
      expect((await history.read(a.customerId, null)).orders).toHaveLength(1);
    } finally {
      await connection`RESET ROLE`; await connection`GRANT INSERT ON bloombox.payments TO bloombox_worker`;
      await connection.end({ timeout: 5 });
    }
  });

  it("rejects an older or misconfigured worker that drops the stored customer association", async () => {
    const a = await customer(), intent = await create(a).execute(input()), event = await paidEvent(intent);
    const legacy = new StripeCommerceEventProcessor(sql, protector, "inclusive", (tx) => ({
      create: async ({ buyerId, occurredAt }) => {
        await tx`INSERT INTO bloombox.buyers (id, created_at) VALUES (${buyerId}, ${occurredAt})`;
      },
    }));
    await expect(legacy.process(event)).rejects.toThrow("must match purchase customer");
    expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${intent.id}`).toHaveLength(0);
    expect((await repository.findById(intent.id))?.status).toBe("CHECKOUT_CREATED");
    await processor.process(event);
    expect((await history.read(a.customerId, null)).orders).toHaveLength(1);
  });

  it("prevents stored intent, buyer and order reassignment, including retroactive guest claims", async () => {
    const a = await customer(), b = await customer(), intent = await create(a).execute(input());
    await processor.process(await paidEvent(intent));
    await expect(sql`UPDATE bloombox.purchase_intents SET customer_id = ${b.customerId} WHERE id = ${intent.id}`).rejects.toThrow("immutable");
    await expect(sql`UPDATE bloombox.purchase_intents SET customer_version = 2 WHERE id = ${intent.id}`).rejects.toThrow("immutable");
    const orders = await sql`SELECT id, buyer_id FROM bloombox.orders WHERE purchase_intent_id = ${intent.id}`;
    await expect(sql`UPDATE bloombox.buyers SET customer_id = ${b.customerId} WHERE id = ${orders[0].buyer_id}`).rejects.toThrow("immutable");
    await expect(sql`UPDATE bloombox.orders SET buyer_id = NULL WHERE id = ${orders[0].id}`).rejects.toThrow("immutable");
    const guest = await create(null).execute(input());
    await expect(sql`UPDATE bloombox.purchase_intents SET customer_id = ${a.customerId}, customer_version = 1 WHERE id = ${guest.id}`).rejects.toThrow("immutable");
  });
});
