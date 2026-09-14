import { CheckoutPreparationUnavailableError } from "@/modules/checkout/application/checkout-session-provider";
import { StripeCheckoutSessionProvider, StripeSdkCheckoutApi, type StripeCheckoutSessionsClient } from "@/modules/checkout/infrastructure/stripe/stripe-checkout-session-provider";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";
import { StartCheckout } from "@/modules/checkout/application/start-checkout";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { PostgresInventoryReservations } from "./postgres-inventory-reservations";
import { PostgresStockAvailabilityReader } from "./postgres-stock-availability-reader";
import { PostgresProductRepository } from "@/modules/catalog/infrastructure/postgres-product-repository";
import { CreatePurchaseIntent } from "@/modules/checkout/application/create-purchase-intent";
import { CancelPurchaseIntent, type CheckoutSessionCanceller } from "@/modules/checkout/application/cancel-purchase-intent";
import { PostgresPurchaseIntentRepository } from "@/modules/checkout/infrastructure/postgres-purchase-intent-repository";
import { PostgresCheckoutBuyerWriter } from "@/modules/customer/infrastructure/postgres-checkout-buyer-writer";
import { StripeCommerceEventProcessor } from "@/modules/payment/infrastructure/stripe-commerce-event-processor";
import { PostgresDataRetentionJob } from "@/shared/infrastructure/database/data-retention-job";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { InsufficientInventoryError } from "../public";
import { PurchaseIntent, purchaseIntentId, catalogProductReference, commerceProductReference } from "@/modules/checkout/domain/purchase-intent";
import { giftMessage, recipientName } from "@/modules/checkout/domain/purchase-intent-policy";
import { money } from "@/shared/domain/money";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeDatabase() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Isolated local test database required");
  return databaseUrl;
}
const describeDatabase = databaseUrl ? describe : describe.skip;
const now = () => new Date("2026-09-13T00:00:00Z");

describeDatabase("native inventory reservations", () => {
  const sql = postgres(safeDatabase(), { max: 8, ssl: false });
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 9)]]) });
  const repo = new PostgresPurchaseIntentRepository(sql, protector, undefined, (tx) => new PostgresInventoryReservations(tx));
  const products = new PostgresProductRepository(sql, new PostgresStockAvailabilityReader(sql));
  const create = new CreatePurchaseIntent(products, repo, now);
  const cancel = new CancelPurchaseIntent(repo);
  const retention = new PostgresDataRetentionJob(sql, undefined, (tx) => new PostgresInventoryReservations(tx));
  const processor = new StripeCommerceEventProcessor(sql, protector, "inclusive", (tx) => new PostgresCheckoutBuyerWriter(tx), undefined, (tx) => new PostgresInventoryReservations(tx));
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let i = 0; i < 2; i++) execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });
  async function stock(quantity: number | null) {
    const id = randomUUID();
    await sql`INSERT INTO bloombox.catalog_products (id, slug, status, available, name, subtitle, description, price_minor, shipping_minor, image_url, image_alt, palette, occasions, flowers, grower)
      VALUES (${id}, ${'stock-' + id}, 'PUBLISHED', true, '在庫試験商品', '試験', '試験用の商品', 4000, 0,
        'https://images.unsplash.com/test-only', '試験', '白', ARRAY['試験'], ARRAY['試験用の花'], '試験')`;
    if (quantity !== null) await sql`INSERT INTO bloombox.inventory_stock (product_id, on_hand) VALUES (${id}, ${quantity})`;
    return id;
  }
  function input(id: string, quantity = 1, requestId: string = randomUUID()) {
    return { requestId, productId: `native_${id}`, quantity, recipientName: "試験", deliveryDate: "2026-09-20", giftMessage: "試験" };
  }
  async function balance(id: string) {
    const rows = await sql`SELECT on_hand, reserved FROM bloombox.inventory_stock WHERE product_id = ${id}`;
    return rows[0];
  }
  async function event(intent: PurchaseIntent, type = "checkout.session.completed") {
    const checkoutId = `cs_test_${intent.id}`;
    await repo.claimCommerceProvider(intent.id, "STRIPE");
    intent.recordCheckoutCreated({ provider: "STRIPE", externalCheckoutId: checkoutId, providerApiVersion: "test", occurredAt: now() });
    await repo.saveCheckoutCreated(intent);
    return {
      provider: "STRIPE" as const, providerAccountId: "acct_example", externalEventId: `evt_${randomUUID()}`,
      eventType: type, externalObjectId: checkoutId, apiVersion: "test", occurredAt: now(),
      payload: { objectType: "checkout_session", id: checkoutId, purchaseIntentId: intent.id, paymentIntentId: `pi_${intent.id}`,
        paymentStatus: type === "checkout.session.completed" ? "paid" : "unpaid",
        checkoutStatus: type === "checkout.session.expired" ? "expired" : "complete",
        amountTotal: intent.item.subtotal.amount, amountSubtotal: intent.item.subtotal.amount, currency: "jpy",
        totalDetails: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }, customerId: null, customerDetails: null, collectedInformation: null },
    };
  }

  it("never offers missing or zero stock and rejects a quantity larger than available stock without partial writes", async () => {
    for (const initial of [null, 0]) {
      const id = await stock(initial);
      expect(await products.findBySlug('stock-' + id)).toMatchObject({ available: false });
      await expect(create.execute(input(id))).rejects.toThrow();
    }
    const id = await stock(1), request = input(id, 2);
    // A legacy unquoted purchase still reaches inventory validation independently of the new one-box quote policy.
    const oversized = PurchaseIntent.create({
      id: purchaseIntentId(request.requestId), displayId: `BBI-TEST-${request.requestId}`,
      item: { productId: catalogProductReference(request.productId), externalProductReference: commerceProductReference(request.productId),
        productName: "試験", quantity: 2, unitPriceSnapshot: money(4000), subtotal: money(8000) },
      recipient: { name: recipientName("試験"), deliveryDate: request.deliveryDate }, giftMessage: giftMessage("試験"), createdAt: now(),
    });
    oversized.transitionTo("READY_FOR_CHECKOUT");
    await expect(repo.save(oversized)).rejects.toBeInstanceOf(InsufficientInventoryError);
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 0 });
    expect(await sql`SELECT id FROM bloombox.purchase_intents WHERE id = ${request.requestId}`).toHaveLength(0);
  });

  it("permits only one winner for the last unit and makes same-request retries reserve only once", async () => {
    const id = await stock(1), requests = Array.from({ length: 8 }, () => input(id));
    const results = await Promise.allSettled(requests.map((request) => create.execute(request)));
    const successes = results.filter((row) => row.status === "fulfilled");
    expect(successes).toHaveLength(1);
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
    const winner = successes[0];
    if (winner.status !== "fulfilled") throw new Error("Expected winner");
    await Promise.all(Array.from({ length: 5 }, () => create.execute(input(id, 1, winner.value.id))));
    expect(await sql`SELECT id FROM bloombox.inventory_movements WHERE purchase_intent_id = ${winner.value.id}`).toHaveLength(1);
    expect((await products.findAvailable()).some((product) => product.id === `native_${id}`)).toBe(false);
  });

  it("cancels unstarted purchases once and allows the released unit to be reserved again", async () => {
    const id = await stock(1), intent = await create.execute(input(id));
    await Promise.all([cancel.execute(intent.id), cancel.execute(intent.id)]);
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 0 });
    expect((await repo.findById(intent.id))?.status).toBe("ABANDONED");
    expect(await sql`SELECT id FROM bloombox.inventory_movements WHERE purchase_intent_id = ${intent.id} AND kind = 'RELEASED'`).toHaveLength(1);
    await create.execute(input(id)); expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
  });

  it.each(["retry", "cancel", "expire"])("keeps a locally rejected checkout recoverable through %s", async (recovery) => {
    const id = await stock(1), intent = await create.execute(input(id));
    const session = { id: `cs_test_${intent.id}`, client_reference_id: intent.id,
      url: "https://checkout.stripe.com/test", expires_at: intent.expiresAt.getTime() / 1000, livemode: false };
    const sessions: StripeCheckoutSessionsClient = { create: vi.fn(async () => session), retrieve: vi.fn(async () => session) };
    const config: StripeConfig = {
      mode: "test", checkoutSecretKey: "rk_test_fixture", reconciliationSecretKey: "rk_test_fixture",
      webhookSecret: "whsec_fixture", accountId: "acct_fixture", shippingRateId: "shr_fixture",
      taxBehavior: "exclusive", automaticTaxEnabled: true, termsAcceptance: "required",
      allowedCheckoutHostnames: ["checkout.stripe.com"], publicOrigin: "https://shop.example.com", apiVersion: "2026-07-29.dahlia",
    };
    const checkout = (taxBehavior: StripeConfig["taxBehavior"]) => new StartCheckout(repo,
      new StripeCheckoutSessionProvider(new StripeSdkCheckoutApi({ ...config, taxBehavior }, sessions), config.apiVersion), now);

    await expect(checkout("exclusive").execute(intent.id)).rejects.toBeInstanceOf(CheckoutPreparationUnavailableError);
    expect(sessions.create).not.toHaveBeenCalled();
    expect((await repo.findById(intent.id))?.commerceProvider).toBeUndefined();
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
    if (recovery === "retry") {
      await checkout("inclusive").execute(intent.id);
      await checkout("inclusive").execute(intent.id);
      expect(sessions.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        shipping_options: [{ shipping_rate_data: { type: "fixed_amount", display_name: "配送料",
          fixed_amount: { amount: 0, currency: "jpy" }, tax_behavior: "inclusive" } }],
      }), { idempotencyKey: `purchase-intent:${intent.id}:checkout:v1` });
      expect((await repo.findById(intent.id))?.status).toBe("CHECKOUT_CREATED");
      expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
      expect(await sql`SELECT id FROM bloombox.inventory_movements WHERE purchase_intent_id = ${intent.id}`).toHaveLength(1);
      return;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (recovery === "cancel") await cancel.execute(intent.id);
      else await retention.execute(new Date("2026-09-15T00:00:00Z"));
    }
    expect((await repo.findById(intent.id))?.status).toBe(recovery === "cancel" ? "ABANDONED" : "EXPIRED");
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 0 });
    expect(await sql`SELECT id FROM bloombox.inventory_movements WHERE purchase_intent_id = ${intent.id} AND kind = 'RELEASED'`).toHaveLength(1);
    await create.execute(input(id));
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("serializes cancellation against provider assignment: the winner determines whether inventory remains held", async () => {
    const id = await stock(1), intent = await create.execute(input(id));
    const results = await Promise.allSettled([cancel.execute(intent.id), repo.claimCommerceProvider(intent.id, "STRIPE")]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    const row = await repo.findById(intent.id);
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: row?.commerceProvider === "STRIPE" ? 1 : 0 });
  });

  it("keeps the reservation through a provider timeout and retries with the same key without reserving again", async () => {
    const id = await stock(1), intent = await create.execute(input(id));
    const keys: string[] = [];
    const session = { id: `cs_test_${intent.id}`, provider: "STRIPE" as const, purchaseIntentId: intent.id,
      url: "https://checkout.stripe.com/test", apiVersion: "test", expiresAt: new Date("2026-09-13T01:00:00Z") };
    const provider = { provider: "STRIPE" as const, validateCreate: vi.fn(),
      create: async (_intent: PurchaseIntent, key: string) => { keys.push(key); if (keys.length === 1) throw new Error("Simulated timeout"); return session; },
      retrieve: async () => session,
    };
    const start = new StartCheckout(repo, provider, now);
    await expect(start.execute(intent.id)).rejects.toThrow("Simulated timeout");
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
    await expect(cancel.execute(intent.id)).rejects.toThrow();
    provider.validateCreate.mockImplementationOnce(() => { throw new CheckoutPreparationUnavailableError(); });
    await expect(start.execute(intent.id)).rejects.toBeInstanceOf(CheckoutPreparationUnavailableError);
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
    expect((await repo.findById(intent.id))?.commerceProvider).toBe("STRIPE");
    await expect(cancel.execute(intent.id)).rejects.toThrow();
    await start.execute(intent.id);
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
    expect((await repo.findById(intent.id))?.status).toBe("CHECKOUT_CREATED");
    expect(await sql`SELECT id FROM bloombox.inventory_movements WHERE purchase_intent_id = ${intent.id}`).toHaveLength(1);
  });

  it("expires only unassigned purchases and holds assigned-but-unrecorded checkouts after local TTL", async () => {
    const free = await stock(1), uncertain = await stock(1);
    const first = await create.execute(input(free)), second = await create.execute(input(uncertain));
    await repo.claimCommerceProvider(second.id, "STRIPE");
    await retention.execute(new Date("2026-09-15T00:00:00Z"));
    await retention.execute(new Date("2026-09-15T00:00:00Z"));
    expect(await balance(free)).toEqual({ on_hand: 1, reserved: 0 });
    expect(await balance(uncertain)).toEqual({ on_hand: 1, reserved: 1 });
    expect((await repo.findById(first.id))?.status).toBe("EXPIRED");
    expect((await repo.findById(second.id))?.status).toBe("READY_FOR_CHECKOUT");
    await expect(cancel.execute(second.id)).rejects.toThrow("決済手続き");
  });

  it.each(["checkout.session.expired", "checkout.session.async_payment_failed"])("releases only a matching verified terminal event: %s", async (type) => {
    const id = await stock(1), intent = await create.execute(input(id)), terminal = await event(intent, type);
    await expect(processor.process({ ...terminal, externalObjectId: "cs_wrong" })).rejects.toThrow();
    await expect(cancel.execute(intent.id)).rejects.toThrow("決済手続き");
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
    await Promise.all([processor.process(terminal), processor.process(terminal)]);
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 0 });
    expect(await sql`SELECT id FROM bloombox.inventory_movements WHERE purchase_intent_id = ${intent.id}`).toHaveLength(2);
    await expect(processor.process({ ...terminal, eventType: "checkout.session.completed",
      payload: { ...terminal.payload, paymentStatus: "paid", checkoutStatus: "complete" } })).rejects.toThrow();
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 0 });
  });

  it("releases a checkout whose creation result was lost only on Stripe's verified expiry event for that purchase", async () => {
    const id = await stock(1), intent = await create.execute(input(id));
    // Stripe was selected before the call; the session may exist, but its ID was never saved.
    await repo.claimCommerceProvider(intent.id, "STRIPE");
    const checkoutId = `cs_test_${intent.id.replaceAll("-", "")}`;
    const expired = {
      provider: "STRIPE" as const, providerAccountId: "acct_example", externalEventId: `evt_${randomUUID()}`,
      eventType: "checkout.session.expired", externalObjectId: checkoutId, apiVersion: "test", occurredAt: now(),
      payload: { objectType: "checkout_session", id: checkoutId, purchaseIntentId: intent.id, paymentIntentId: null,
        paymentStatus: "unpaid", checkoutStatus: "expired", amountTotal: intent.item.subtotal.amount, amountSubtotal: intent.item.subtotal.amount,
        currency: "jpy", totalDetails: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }, customerId: null, customerDetails: null, collectedInformation: null },
    };
    await expect(processor.process({ ...expired, externalEventId: `evt_${randomUUID()}`, eventType: "checkout.session.async_payment_failed",
      payload: { ...expired.payload, checkoutStatus: "complete" } })).rejects.toThrow();
    await expect(processor.process({ ...expired, externalEventId: `evt_${randomUUID()}`, eventType: "checkout.session.completed",
      payload: { ...expired.payload, paymentStatus: "paid", checkoutStatus: "complete", paymentIntentId: `pi_${intent.id}` } })).rejects.toThrow();
    const unassigned = await create.execute(input(await stock(1)));
    await expect(processor.process({ ...expired, externalEventId: `evt_${randomUUID()}`,
      payload: { ...expired.payload, purchaseIntentId: unassigned.id } })).rejects.toThrow();
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
    expect((await repo.findById(intent.id))?.status).toBe("READY_FOR_CHECKOUT");

    await Promise.all([processor.process(expired), processor.process({ ...expired, externalEventId: `evt_${randomUUID()}` })]);
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 0 });
    expect((await repo.findById(intent.id))?.status).toBe("EXPIRED");
    expect(await sql`SELECT id FROM bloombox.inventory_movements WHERE purchase_intent_id = ${intent.id} AND kind = 'RELEASED'`).toHaveLength(1);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${intent.id} AND action = 'checkout.expired.unrecorded_session'`).toHaveLength(1);
    await create.execute(input(id));
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
  });

  it("closes an issued checkout on customer cancellation but releases only on the verified expiry event", async () => {
    const id = await stock(1), intent = await create.execute(input(id)), expired = await event(intent, "checkout.session.expired");
    const expire = vi.fn<CheckoutSessionCanceller["expire"]>().mockResolvedValue("EXPIRED");
    const customerCancel = new CancelPurchaseIntent(repo, undefined, { provider: "STRIPE", expire });
    await expect(customerCancel.execute(intent.id)).resolves.toBe("EXPIRY_CONFIRMED");
    expect(expire).toHaveBeenCalledExactlyOnceWith(`cs_test_${intent.id}`, intent.id);
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
    expect((await repo.findById(intent.id))?.status).toBe("CHECKOUT_CREATED");
    // A retried cancellation may race the verified event; either order releases exactly once.
    await Promise.all([processor.process(expired), customerCancel.execute(intent.id), processor.process(expired)]);
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 0 });
    await expect(customerCancel.execute(intent.id)).resolves.toBe("ALREADY_CLOSED");
    expect(await sql`SELECT id FROM bloombox.inventory_movements WHERE purchase_intent_id = ${intent.id} AND kind = 'RELEASED'`).toHaveLength(1);
  });

  it("commits stock and one order once; a delayed expiry or a refund never restocks committed goods", async () => {
    const id = await stock(2), intent = await create.execute(input(id)), paid = await event(intent);
    await Promise.all([processor.process(paid), processor.process(paid), processor.process(paid)]);
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 0 });
    await processor.process({ ...paid, eventType: "checkout.session.expired", payload: { ...paid.payload, paymentStatus: "unpaid", checkoutStatus: "expired" } });
    await processor.process({ ...paid, eventType: "refund.updated", externalEventId: `evt_${randomUUID()}`, externalObjectId: `re_${intent.id}`,
      payload: { objectType: "refund", id: `re_${intent.id}`, paymentIntentId: paid.payload.paymentIntentId, amount: 4000, currency: "jpy", status: "succeeded", reason: null, failureReason: null } });
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 0 });
    expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${intent.id}`).toHaveLength(1);
    expect(await sql`SELECT id FROM bloombox.inventory_movements WHERE purchase_intent_id = ${intent.id}`).toHaveLength(2);
  });

  it("rolls reservations back with failed purchase persistence and keeps application stock permissions narrow", async () => {
    const id = await stock(2), request = input(id), connection = postgres(safeDatabase(), { max: 1, ssl: false });
    try {
      await connection`REVOKE INSERT ON bloombox.outbox_events FROM bloombox_application`;
      await connection`SET ROLE bloombox_application`;
      const storage = new PostgresPurchaseIntentRepository(connection, protector, undefined, (tx) => new PostgresInventoryReservations(tx));
      const scoped = new CreatePurchaseIntent(new PostgresProductRepository(connection, new PostgresStockAvailabilityReader(connection)), storage, now);
      await expect(scoped.execute(request)).rejects.toThrow();
      expect(await balance(id)).toEqual({ on_hand: 2, reserved: 0 });
      expect(await sql`SELECT purchase_intent_id FROM bloombox.inventory_reservations WHERE purchase_intent_id = ${request.requestId}`).toHaveLength(0);
      await connection`RESET ROLE`; await connection`GRANT INSERT ON bloombox.outbox_events TO bloombox_application`;
      await connection`SET ROLE bloombox_application`;
      const intent = await scoped.execute(request);
      await new CancelPurchaseIntent(storage).execute(intent.id);
      expect(await balance(id)).toEqual({ on_hand: 2, reserved: 0 });
      await expect(connection`UPDATE bloombox.inventory_stock SET on_hand = 100 WHERE product_id = ${id}`).rejects.toThrow();
      await expect(connection`DELETE FROM bloombox.inventory_movements`).rejects.toThrow();
    } finally {
      await connection`RESET ROLE`; await connection`GRANT INSERT ON bloombox.outbox_events TO bloombox_application`;
      await connection.end({ timeout: 5 });
    }
  });

  it("rolls order and inventory back if movement persistence fails, then recovers through the worker role", async () => {
    const id = await stock(1), intent = await create.execute(input(id)), paid = await event(intent);
    const connection = postgres(safeDatabase(), { max: 1, ssl: false });
    try {
      await connection`REVOKE INSERT ON bloombox.inventory_movements FROM bloombox_worker`;
      await connection`SET ROLE bloombox_worker`;
      const worker = new StripeCommerceEventProcessor(connection, protector, "inclusive", (tx) => new PostgresCheckoutBuyerWriter(tx), undefined, (tx) => new PostgresInventoryReservations(tx));
      await expect(worker.process(paid)).rejects.toThrow();
      expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
      expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${intent.id}`).toHaveLength(0);
      await connection`RESET ROLE`; await connection`GRANT INSERT ON bloombox.inventory_movements TO bloombox_worker`;
      await connection`SET ROLE bloombox_worker`;
      await worker.process(paid);
      expect(await balance(id)).toEqual({ on_hand: 0, reserved: 0 });
    } finally {
      await connection`RESET ROLE`; await connection`GRANT INSERT ON bloombox.inventory_movements TO bloombox_worker`;
      await connection.end({ timeout: 5 });
    }
  });

  it("prevents old code from skipping reservation, commit or release steps", async () => {
    const id = await stock(1), intent = await create.execute(input(id));
    await expect(sql`UPDATE bloombox.purchase_intents SET status = 'EXPIRED' WHERE id = ${intent.id}`).rejects.toThrow("consistent inventory");
    const paid = await event(intent);
    await expect(sql`UPDATE bloombox.purchase_intents SET status = 'CONVERTED' WHERE id = ${intent.id}`).rejects.toThrow("consistent inventory");
    const legacy = new StripeCommerceEventProcessor(sql, protector, "inclusive", (tx) => new PostgresCheckoutBuyerWriter(tx));
    await expect(legacy.process(paid)).rejects.toThrow();
    expect(await balance(id)).toEqual({ on_hand: 1, reserved: 1 });
    expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${intent.id}`).toHaveLength(0);
    await expect(sql`UPDATE bloombox.inventory_reservations SET quantity = 2 WHERE purchase_intent_id = ${intent.id}`).rejects.toThrow("immutable");
  });
});
