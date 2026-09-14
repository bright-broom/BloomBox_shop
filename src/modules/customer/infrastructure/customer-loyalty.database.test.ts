import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { PostgresCustomerIdentityRepository } from "./postgres-customer-identity-repository";
import { PostgresCheckoutBuyerWriter } from "./postgres-checkout-buyer-writer";
import { PostgresCustomerPurchasePerformance } from "@/modules/order/infrastructure/postgres-customer-purchase-performance";
import { PostgresCustomerOrderHistory } from "@/modules/order/infrastructure/postgres-customer-order-history";
import { PostgresInventoryReservations } from "@/modules/inventory/infrastructure/postgres-inventory-reservations";
import { PostgresStockAvailabilityReader } from "@/modules/inventory/infrastructure/postgres-stock-availability-reader";
import { PostgresProductRepository } from "@/modules/catalog/infrastructure/postgres-product-repository";
import { CreatePurchaseIntent } from "@/modules/checkout/application/create-purchase-intent";
import { StartCheckout } from "@/modules/checkout/application/start-checkout";
import { PostgresPurchaseIntentRepository } from "@/modules/checkout/infrastructure/postgres-purchase-intent-repository";
import { StripeCheckoutSessionProvider, StripeSdkCheckoutApi, type StripeCheckoutSessionsClient } from "@/modules/checkout/infrastructure/stripe/stripe-checkout-session-provider";
import { StripeCommerceEventProcessor } from "@/modules/payment/infrastructure/stripe-commerce-event-processor";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { loyaltyProgress } from "../public";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeDatabase() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Isolated local test database required");
  return databaseUrl;
}
const now = () => new Date("2026-09-14T00:00:00Z");
(databaseUrl ? describe : describe.skip)("customer rank, durable quotes and paid-order reconciliation", () => {
  const sql = postgres(safeDatabase(), { max: 8, ssl: false });
  const identities = new PostgresCustomerIdentityRepository(sql);
  const performance = new PostgresCustomerPurchasePerformance(sql);
  const history = new PostgresCustomerOrderHistory(sql);
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 7)]]) });
  const repo = new PostgresPurchaseIntentRepository(sql, protector, undefined, (tx) => new PostgresInventoryReservations(tx));
  const products = new PostgresProductRepository(sql, new PostgresStockAvailabilityReader(sql));
  const processor = new StripeCommerceEventProcessor(sql, protector, "inclusive", (tx) => new PostgresCheckoutBuyerWriter(tx), undefined, (tx) => new PostgresInventoryReservations(tx));
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let i = 0; i < 2; i++) execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });
  const customer = () => identities.registerGoogleSubject(randomUUID());
  async function paid(customerId: string | null, subtotal = 4000, discount = 0, refunded = 0, status = "CAPTURED", provider = "STRIPE") {
    const buyerId = randomUUID(), orderId = randomUUID(), paymentId = randomUUID(), total = subtotal - discount + 1000;
    await sql`INSERT INTO bloombox.buyers (id, customer_id) VALUES (${buyerId}, ${customerId})`;
    await sql`INSERT INTO bloombox.orders (id, display_id, buyer_id, status, commerce_provider, external_order_id,
      currency, subtotal_minor, tax_minor, shipping_minor, discount_minor, total_minor, created_at, updated_at)
      VALUES (${orderId}, ${'BB-' + orderId}, ${buyerId}, 'CONFIRMED', ${provider}, ${orderId}, 'JPY', ${subtotal}, 0, 1000, ${discount}, ${total}, now(), now())`;
    await sql`INSERT INTO bloombox.order_items (id, order_id, product_name_snapshot, quantity, unit_amount_minor, tax_minor, discount_minor, line_total_minor, currency, position, external_product_id, catalog_product_id)
      VALUES (${randomUUID()}, ${orderId}, '購入時の花', 1, ${subtotal}, 0, ${discount}, ${subtotal - discount}, 'JPY', 0, 'fixture', 'fixture')`;
    await sql`INSERT INTO bloombox.payments (id, order_id, commerce_provider, external_payment_id, status,
      amount_requested_minor, amount_authorized_minor, amount_captured_minor, amount_refunded_minor, currency, created_at, updated_at)
      VALUES (${paymentId}, ${orderId}, ${provider}, ${'pi_' + paymentId}, ${status}, ${total}, ${total}, ${total}, ${refunded}, 'JPY', now(), now())`;
    return { orderId, paymentId };
  }
  it("aggregates all pages for only the active buyer and does not expose recipient or foreign histories", async () => {
    const a = await customer(), b = await customer();
    for (let i = 0; i < 12; i++) await paid(a.customerId);
    await paid(b.customerId, 8000); await paid(null, 90000); await paid(a.customerId, 90000, 0, 0, "CAPTURED", "SHOPIFY");
    expect(await performance.readEligibleSpend(a.customerId)).toBe(48000);
    expect(await performance.readEligibleSpend(b.customerId)).toBe(8000);
    const first = await history.read(a.customerId, null), second = await history.read(a.customerId, first.nextCursor);
    expect(first.orders).toHaveLength(10); expect(second.orders).toHaveLength(2);
    expect(first.orders[0].items).toEqual([{ name: "購入時の花", quantity: 1 }]);
    expect(await performance.readEligibleSpend(a.customerId)).toBe(48000);
    expect(await performance.readEligibleSpend((await customer()).customerId)).toBe(0);
    await expect(performance.readEligibleSpend(randomUUID())).rejects.toThrow();
    await sql`UPDATE bloombox.customer_accounts SET status = 'DISABLED' WHERE id = ${a.customerId}`;
    await expect(performance.readEligibleSpend(a.customerId)).rejects.toThrow();
    expect((await history.read(a.customerId, null)).orders).toEqual([]);
  });
  it("subtracts only net goods and successful refunds, excluding unsafe/cancelled/multiple-payment states", async () => {
    const a = await customer();
    await paid(a.customerId, 4000, 80, 500, "PARTIALLY_REFUNDED"); // 3420, excludes 1000 shipping
    await paid(a.customerId, 4000, 0, 5000, "REFUNDED");
    for (const status of ["DISPUTED", "FAILED", "PROCESSING", "AUTHORIZED"]) await paid(a.customerId, 4000, 0, 0, status);
    const cancelled = await paid(a.customerId);
    await sql`UPDATE bloombox.orders SET status = 'CANCELLED' WHERE id = ${cancelled.orderId}`;
    const multiple = await paid(a.customerId);
    await sql`INSERT INTO bloombox.payments (id, order_id, commerce_provider, external_payment_id, status, amount_requested_minor, currency, created_at, updated_at)
      VALUES (${randomUUID()}, ${multiple.orderId}, 'STRIPE', ${randomUUID()}, 'FAILED', 5000, 'JPY', now(), now())`;
    const partial = await paid(a.customerId);
    await sql`UPDATE bloombox.payments SET amount_captured_minor = 4999 WHERE id = ${partial.paymentId}`;
    expect(await performance.readEligibleSpend(a.customerId)).toBe(3420);
  });
  it("reads under the existing application role and surfaces failures rather than awarding a zero rank", async () => {
    const a = await customer(); await paid(a.customerId, 12000);
    const connection = postgres(safeDatabase(), { max: 1, ssl: false });
    try {
      await connection`SET ROLE bloombox_application`;
      expect(await new PostgresCustomerPurchasePerformance(connection).readEligibleSpend(a.customerId)).toBe(12000);
      await connection`RESET ROLE`; await connection`REVOKE SELECT ON bloombox.payments FROM bloombox_application`;
      await connection`SET ROLE bloombox_application`;
      await expect(new PostgresCustomerPurchasePerformance(connection).readEligibleSpend(a.customerId)).rejects.toThrow();
    } finally {
      await connection`RESET ROLE`; await connection`GRANT SELECT ON bloombox.payments TO bloombox_application`;
      await connection.end({ timeout: 5 });
    }
  });
  it("fixes one rank quote across races, refunds and retries; sends net Stripe price and verifies exact settlement", async () => {
    const a = await customer(), b = await customer(), initial = await paid(a.customerId, 12000), product = randomUUID();
    await sql`INSERT INTO bloombox.catalog_products (id, slug, status, available, name, subtitle, description, price_minor, shipping_minor, image_url, image_alt, palette, occasions, flowers, grower)
      VALUES (${product}, ${'loyalty-' + product}, 'PUBLISHED', true, '特典試験商品', '試験', '試験用の商品', 4000, 1000,
        'https://images.unsplash.com/test-only', '試験', '白', ARRAY['試験'], ARRAY['試験用の花'], '試験')`;
    await sql`INSERT INTO bloombox.inventory_stock (product_id, on_hand) VALUES (${product}, 20)`;
    const input = { requestId: randomUUID(), productId: `native_${product}`, quantity: 1, recipientName: "試験", deliveryDate: "2026-09-20", giftMessage: "試験" };
    const create = (actor = a) => new CreatePurchaseIntent(products, repo, now, () => true, async () => actor, performance);
    const intents = await Promise.all(Array.from({ length: 4 }, () => create().execute(input)));
    expect(intents.every((intent) => intent.loyalty?.discountYen === 80)).toBe(true);
    const intent = intents[0];
    expect((await repo.findById(intent.id))?.loyalty).toEqual(intent.loyalty);
    await expect(create(b).execute(input)).rejects.toThrow("ログイン状態");
    await expect(sql`UPDATE bloombox.purchase_intents SET loyalty_discount_minor = 0 WHERE id = ${intent.id}`).rejects.toThrow("immutable");
    await expect(sql`UPDATE bloombox.purchase_intents SET loyalty_snapshot = NULL WHERE id = ${intent.id}`).rejects.toThrow("immutable");
    if (!intent.loyalty) throw new Error("Expected saved quote");
    for (const snapshot of [{ ...intent.loyalty, tier: "SEED" }, { ...intent.loyalty, basisPoints: null },
      { ...intent.loyalty, discountYen: 81 }, { ...intent.loyalty, eligibleSpendYen: 11999 }]) {
      await expect(sql`INSERT INTO bloombox.purchase_intents
        SELECT (jsonb_populate_record(NULL::bloombox.purchase_intents,
          to_jsonb(source) || jsonb_build_object('id', ${randomUUID()}::text, 'display_id', ${randomUUID()}::text,
            'loyalty_snapshot', ${sql.json(snapshot)}))).*
        FROM bloombox.purchase_intents source WHERE source.id = ${intent.id}`).rejects.toMatchObject({ code: "23514" });
    }
    // A later refund changes only the next new quote, never this request's saved price.
    await sql`UPDATE bloombox.payments SET amount_refunded_minor = 100, status = 'PARTIALLY_REFUNDED' WHERE id = ${initial.paymentId}`;
    expect((await create().execute(input)).loyalty?.discountYen).toBe(80);
    expect((await create().execute({ ...input, requestId: randomUUID() })).loyalty?.discountYen).toBe(0);
    const checkoutId = `cs_test_${intent.id}`;
    const session = { id: checkoutId, client_reference_id: intent.id, url: "https://checkout.stripe.com/test", expires_at: intent.expiresAt.getTime() / 1000, livemode: false };
    const sessions: StripeCheckoutSessionsClient = { create: vi.fn(async () => session), retrieve: vi.fn(async () => session) };
    const provider = new StripeCheckoutSessionProvider(new StripeSdkCheckoutApi({ mode: "test", checkoutSecretKey: "rk_test_fixture", reconciliationSecretKey: "rk_test_fixture",
      webhookSecret: "whsec_fixture", accountId: "acct_fixture", shippingRateId: "shr_fixture", taxBehavior: "inclusive", automaticTaxEnabled: true,
      termsAcceptance: "required", allowedCheckoutHostnames: ["checkout.stripe.com"], publicOrigin: "https://shop.example.com", apiVersion: "2026-07-29.dahlia" }, sessions), "2026-07-29.dahlia");
    const start = new StartCheckout(repo, provider, now, () => true, async () => a);
    await start.execute(intent.id); await start.execute(intent.id);
    expect(sessions.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      line_items: [expect.objectContaining({ quantity: 1, price_data: expect.objectContaining({ unit_amount: 3920 }) })],
      shipping_options: [expect.objectContaining({ shipping_rate_data: expect.objectContaining({ fixed_amount: { amount: 1000, currency: "jpy" } }) })],
    }), { idempotencyKey: `purchase-intent:${intent.id}:checkout:v1` });
    const event = { provider: "STRIPE" as const, providerAccountId: "acct_fixture", externalEventId: `evt_${intent.id}`,
      eventType: "checkout.session.completed", externalObjectId: checkoutId, apiVersion: "test", occurredAt: now(),
      payload: { objectType: "checkout_session", id: checkoutId, purchaseIntentId: intent.id, paymentIntentId: `pi_${intent.id}`,
        paymentStatus: "paid", checkoutStatus: "complete", amountTotal: 4920, amountSubtotal: 3920, currency: "jpy",
        totalDetails: { amount_discount: 0, amount_shipping: 1000, amount_tax: 356 }, customerId: null, customerDetails: null, collectedInformation: null } };
    for (const payload of [{ ...event.payload, amountTotal: 5000, amountSubtotal: 4000 },
      { ...event.payload, amountTotal: 4919 }, { ...event.payload, totalDetails: { ...event.payload.totalDetails, amount_discount: 80 } },
      { ...event.payload, totalDetails: { ...event.payload.totalDetails, amount_shipping: 999 } }]) {
      await expect(processor.process({ ...event, payload })).rejects.toThrow("inconsistent");
      expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${intent.id}`).toHaveLength(0);
    }
    await Promise.all([processor.process(event), processor.process(event), processor.process(event)]);
    const rows = await sql`SELECT id, subtotal_minor, discount_minor, total_minor FROM bloombox.orders WHERE purchase_intent_id = ${intent.id}`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].subtotal_minor)).toBe(4000); expect(Number(rows[0].discount_minor)).toBe(80); expect(Number(rows[0].total_minor)).toBe(4920);
    expect(await history.readDetail(a.customerId, rows[0].id)).toMatchObject({ discountYen: 80, totalYen: 4920, items: [{ unitYen: 4000, totalYen: 3920 }] });
    expect(await history.readDetail(b.customerId, rows[0].id)).toBeNull();
    expect(await performance.readEligibleSpend(a.customerId)).toBe(15820);
    const refund = { ...event, eventType: "refund.created", externalObjectId: "re_loyalty", externalEventId: "evt_refund_pending",
      payload: { objectType: "refund", id: "re_loyalty", paymentIntentId: `pi_${intent.id}`, amount: 3920, currency: "jpy", status: "pending", reason: null, failureReason: null } };
    await processor.process(refund); expect(await performance.readEligibleSpend(a.customerId)).toBe(15820);
    const settledRefund = { ...refund, externalEventId: "evt_refund_ok", eventType: "refund.updated", payload: { ...refund.payload, status: "succeeded" } };
    await processor.process(settledRefund); await processor.process(settledRefund); await processor.process(refund);
    expect(await performance.readEligibleSpend(a.customerId)).toBe(11900); // remaining shipping cannot earn rank
    expect(loyaltyProgress(await performance.readEligibleSpend(a.customerId)).tier.id).toBe("SEED");
    expect((await repo.findById(intent.id))?.loyalty?.discountYen).toBe(80);
  });
});
