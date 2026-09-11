import { PostgresShopifyOrderAcceptor } from "@/modules/order/infrastructure/postgres-shopify-order-acceptor";
import { PostgresShopifyFulfillmentIntake } from "@/modules/fulfillment/infrastructure/postgres-shopify-fulfillment-intake";
import { ShopifyFulfillmentIntakeError } from "@/modules/fulfillment/public";
import { PostgresShopifyAcceptedOrderQuery } from "@/modules/order/infrastructure/postgres-shopify-accepted-order-query";
import { PostgresShopifyOrderPaymentProjector } from "@/modules/payment/infrastructure/shopify/postgres-shopify-order-payment-projector";
import { ShopifyOrderPaymentProjectionError } from "@/modules/payment/application/project-shopify-order-payment";
import { PostgresShopifyPurchaseConverter } from "./postgres-shopify-purchase-converter";
import { ShopifyPurchaseConversionError } from "../../application/convert-shopify-purchase";
import { ShopifyAdminOrderReader } from "@/modules/payment/infrastructure/shopify/shopify-admin-order-reader";
import { ShopifyAdminOrderAcceptor } from "@/modules/payment/infrastructure/shopify/shopify-admin-order-acceptor";
import { ReadShopifyReference } from "@/modules/payment/application/read-shopify-reference";
import { ReconcileShopifyPayment } from "@/modules/payment/application/reconcile-shopify-payment";
import { ShopifyDeliveryDestinationUnavailableError } from "@/modules/payment/application/shopify-delivery-destination-reader";
import { ShopifyOrderAcceptanceConflictError, ShopifyOrderAcceptancePersistenceError,
  type ShopifyOrderAcceptance, type ShopifyOrderAcceptancePolicy } from "@/modules/order/application/accept-shopify-order";
import { PostgresShopifyDeliveryPlanQuery } from "./postgres-shopify-delivery-plan-query";
import { ShopifyDeliveryPlanUnavailableError } from "../../application/shopify-delivery-plan-query";
import { PostgresShopifyPaymentEvidence } from "@/modules/payment/infrastructure/shopify/postgres-shopify-payment-evidence";
import { SettlementEvidenceConflictError, type SettlementSnapshot } from "@/modules/payment/domain/settlement-evidence";
import { ShopifyPaymentEvidencePersistenceError } from "@/modules/payment/application/reconcile-shopify-payment";
import { PostgresShopifyOrderLinker } from "./postgres-shopify-order-linker";
import { shopifyCartTokenDigest } from "./shopify-cart-identity";
import { ShopifyOrderLinkUnresolvedError, ShopifyOrderLinkPersistenceError, type ShopifyOrderLinkInput } from "../../application/link-shopify-order";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { money } from "@/shared/domain/money";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { PostgresDataRetentionJob } from "@/shared/infrastructure/database/data-retention-job";
import { PurchaseIntent, purchaseIntentId, catalogProductReference, commerceProductReference } from "../../domain/purchase-intent";
import { giftMessage, recipientName } from "../../domain/purchase-intent-policy";
import { PostgresPurchaseIntentRepository } from "../postgres-purchase-intent-repository";
import { PostgresShopifyCheckoutAttempts } from "./postgres-shopify-checkout-attempts";
import { StartShopifyCheckout, SHOPIFY_STALE_ATTEMPT_MS } from "../../application/start-shopify-checkout";
import { StartCheckout } from "../../application/start-checkout";
import { CheckoutPausedError } from "../../application/checkout-paused-error";
import { ShopifyCheckoutConflictError, ShopifyCheckoutPersistenceError, ShopifyCheckoutUncertainError, type ShopifyCheckoutAttempts } from "../../application/shopify-checkout-attempt";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeUrl() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Local test database required");
  return databaseUrl;
}
const describeDatabase = databaseUrl ? describe : describe.skip;
const now = new Date("2026-09-11T00:00:00Z");
const scope = "example-shop.myshopify.com";

describeDatabase("durable Shopify checkout attempts", () => {
  const sql = postgres(safeUrl(), { max: 4, ssl: false });
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 21)]]) });
  const intents = new PostgresPurchaseIntentRepository(sql, protector);
  const attempts = new PostgresShopifyCheckoutAttempts(sql, protector);
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let i = 0; i < 2; i++) execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });
  async function prepare() { const intent = makeIntent(); await intents.save(intent); return intent; }
  function flow(intent: PurchaseIntent, repo: ShopifyCheckoutAttempts = attempts, enabled = () => true) {
    const cart = cartFor(intent);
    const provider = { scope, create: vi.fn(async () => cart), retrieve: vi.fn(async () => cart) };
    return { provider, useCase: new StartShopifyCheckout(intents, repo, provider, randomUUID, () => now, enabled) };
  }

  function linkInput(intent: PurchaseIntent, orderId = "gid://shopify/Order/" + Date.now()) : ShopifyOrderLinkInput {
    return { shop: scope, orderId, apiVersion: "2026-07", cartToken: `opaque-${intent.id}`,
      lines: [{ variantId: intent.item.externalProductReference, quantity: 1, originalUnitPrice: money(4000) }] };
  }

  it("links concurrently exactly once with atomic audit/Outbox and no commerce transitions", async () => {
    const intent = await prepare(); await flow(intent).useCase.execute(intent.id);
    const input = linkInput(intent, "gid://shopify/Order/1001");
    const linker = new PostgresShopifyOrderLinker(sql, () => now);
    const results = await Promise.all(Array.from({ length: 6 }, () => linker.link(input)));
    expect(results.every((result) => result.purchaseIntentId === intent.id)).toBe(true);
    expect(JSON.stringify(results)).not.toContain(`opaque-${intent.id}`);
    const rows = await sql`SELECT cart_token_digest FROM bloombox.shopify_checkout_attempts WHERE purchase_intent_id = ${intent.id}`;
    expect(rows[0].cart_token_digest).toBe(shopifyCartTokenDigest(`opaque-${intent.id}`));
    const links = await sql`SELECT * FROM bloombox.shopify_order_links WHERE purchase_intent_id = ${intent.id}`;
    const events = await sql`SELECT payload FROM bloombox.outbox_events WHERE aggregate_id = ${intent.id} AND event_type = 'checkout.shopify_order.linked'`;
    const audits = await sql`SELECT safe_metadata FROM bloombox.audit_logs WHERE resource_id = ${intent.id} AND action = 'checkout.shopify_order.linked'`;
    expect(links).toHaveLength(1); expect(events).toHaveLength(1); expect(audits).toHaveLength(1);
    expect(JSON.stringify([links, events, audits])).not.toMatch(/secret-key|cartToken|cart_token_digest|opaque-/);
    expect((await sql`SELECT status FROM bloombox.purchase_intents WHERE id = ${intent.id}`)[0].status).toBe("CHECKOUT_CREATED");
    expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${intent.id}`).toHaveLength(0);
    await expect(linker.link({ ...input, orderId: "gid://shopify/Order/1002" })).rejects.toBeInstanceOf(ShopifyOrderLinkUnresolvedError);
  });

  it("rejects wrong cart/shop/API/item facts and absent tokens without creating links", async () => {
    const intent = await prepare(); await flow(intent).useCase.execute(intent.id);
    const input = linkInput(intent, "gid://shopify/Order/1101"); const linker = new PostgresShopifyOrderLinker(sql);
    const candidates: ShopifyOrderLinkInput[] = [
      { ...input, cartToken: null }, { ...input, cartToken: "someone-elses-cart" },
      { ...input, shop: "another-shop.myshopify.com" }, { ...input, apiVersion: "2026-04" },
      { ...input, lines: [] }, { ...input, lines: [input.lines[0], input.lines[0]] },
      { ...input, lines: [{ ...input.lines[0], variantId: null }] },
      { ...input, lines: [{ ...input.lines[0], variantId: "gid://shopify/ProductVariant/102" }] },
      { ...input, lines: [{ ...input.lines[0], quantity: 2 }] },
      { ...input, lines: [{ ...input.lines[0], originalUnitPrice: money(3999) }] },
    ];
    for (const value of candidates) await expect(linker.link(value)).rejects.toBeInstanceOf(ShopifyOrderLinkUnresolvedError);
    expect(await sql`SELECT * FROM bloombox.shopify_order_links WHERE purchase_intent_id = ${intent.id}`).toHaveLength(0);
  });

  it("does not attach the same Shopify order to a second purchase attempt", async () => {
    const first = await prepare(); const second = await prepare();
    await flow(first).useCase.execute(first.id); await flow(second).useCase.execute(second.id);
    const linker = new PostgresShopifyOrderLinker(sql);
    const results = await Promise.allSettled([first, second].map((intent) => linker.link(linkInput(intent, "gid://shopify/Order/1201"))));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await sql`SELECT * FROM bloombox.shopify_order_links WHERE external_order_id = 'gid://shopify/Order/1201'`).toHaveLength(1);
  });

  it("prevents reusing a cart identity for a different intent and rolls back completion", async () => {
    const first = await prepare(); const second = await prepare();
    await flow(first).useCase.execute(first.id);
    const secondAttempt = randomUUID(); await attempts.claim(second.id, secondAttempt, scope, now);
    await expect(attempts.complete(second.id, secondAttempt, { ...cartFor(second), cartId: cartFor(first).cartId }, now)).rejects.toBeInstanceOf(ShopifyCheckoutPersistenceError);
    expect((await sql`SELECT status FROM bloombox.shopify_checkout_attempts WHERE purchase_intent_id = ${second.id}`)[0].status).toBe("CREATING");
    expect((await sql`SELECT status FROM bloombox.purchase_intents WHERE id = ${second.id}`)[0].status).toBe("READY_FOR_CHECKOUT");
  });

  it("holds legacy unindexed READY attempts until credentials are reverified on resume", async () => {
    const intent = await prepare(); const attemptId = randomUUID(); await attempts.claim(intent.id, attemptId, scope, now);
    const credential = protector.protect(cartFor(intent).cartId, `shopify-cart:${intent.id}:${attemptId}:${scope}:v1`);
    await sql`UPDATE bloombox.shopify_checkout_attempts SET status = 'READY', credential_key_id = ${credential.keyId}, credential_ciphertext = ${credential.ciphertext}, api_version = '2026-07' WHERE purchase_intent_id = ${intent.id}`;
    await sql`UPDATE bloombox.purchase_intents SET status = 'CHECKOUT_CREATED', provider_api_version = '2026-07', checkout_created_at = ${now} WHERE id = ${intent.id}`;
    const linker = new PostgresShopifyOrderLinker(sql);
    await expect(linker.link(linkInput(intent, "gid://shopify/Order/1301"))).rejects.toBeInstanceOf(ShopifyOrderLinkUnresolvedError);
    await flow(intent).useCase.execute(intent.id);
    await expect(linker.link(linkInput(intent, "gid://shopify/Order/1301"))).resolves.toMatchObject({ purchaseIntentId: intent.id });
  });

  it("keeps cart identities and order associations immutable in the database", async () => {
    const intent = await prepare(); await flow(intent).useCase.execute(intent.id);
    await new PostgresShopifyOrderLinker(sql).link(linkInput(intent, "gid://shopify/Order/1401"));
    await expect(sql`UPDATE bloombox.shopify_checkout_attempts SET cart_token_digest = NULL WHERE purchase_intent_id = ${intent.id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE bloombox.shopify_order_links SET external_order_id = 'gid://shopify/Order/1402' WHERE purchase_intent_id = ${intent.id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM bloombox.shopify_order_links WHERE purchase_intent_id = ${intent.id}`).rejects.toMatchObject({ code: "23514" });
  });

  it("links with worker privileges and rolls back the link if its Outbox write fails", async () => {
    const intent = await prepare(); await flow(intent).useCase.execute(intent.id);
    const worker = postgres(safeUrl(), { max: 1, ssl: false });
    try {
      await worker`SET ROLE bloombox_worker`;
      await worker`SET statement_timeout = '5s'`;
      await sql`REVOKE INSERT ON bloombox.outbox_events FROM bloombox_worker`;
      try {
        await expect(new PostgresShopifyOrderLinker(worker).link(linkInput(intent, "gid://shopify/Order/1501"))).rejects.toBeInstanceOf(ShopifyOrderLinkPersistenceError);
        expect(await sql`SELECT * FROM bloombox.shopify_order_links WHERE purchase_intent_id = ${intent.id}`).toHaveLength(0);
        expect(await sql`SELECT * FROM bloombox.audit_logs WHERE resource_id = ${intent.id} AND action = 'checkout.shopify_order.linked'`).toHaveLength(0);
      } finally { await sql`GRANT INSERT ON bloombox.outbox_events TO bloombox_worker`; }
      await expect(new PostgresShopifyOrderLinker(worker).link(linkInput(intent, "gid://shopify/Order/1501"))).resolves.toMatchObject({ purchaseIntentId: intent.id });
      const privileges = await sql`SELECT has_table_privilege('bloombox_worker', 'bloombox.shopify_order_links', 'UPDATE') AS update_link, has_table_privilege('bloombox_worker', 'bloombox.shopify_checkout_attempts', 'UPDATE') AS update_cart`;
      expect(privileges[0]).toEqual({ update_link: false, update_cart: false });
    } finally { await worker.end({ timeout: 5 }); }
  });

  const saleTransaction = { id: "gid://shopify/OrderTransaction/7001", kind: "SALE" as const, status: "SUCCEEDED" as const, parentId: null, amount: 4000 };
  function paidSnapshot(): SettlementSnapshot {
    return { updatedAt: "2026-09-11T10:00:00Z", cancelledAt: null, test: true, requested: 4000, received: 4000, refunded: 0, transactions: [saleTransaction] };
  }
  function refundedSnapshot(amount = 500): SettlementSnapshot {
    return { ...paidSnapshot(), updatedAt: "2026-09-11T11:00:00Z", refunded: amount,
      transactions: [saleTransaction, { id: "gid://shopify/OrderTransaction/7002", kind: "REFUND", status: "SUCCEEDED", parentId: saleTransaction.id, amount }] };
  }
  async function linkedForPayment(orderId: string) {
    const intent = await prepare(); await flow(intent).useCase.execute(intent.id);
    const link = await new PostgresShopifyOrderLinker(sql).link(linkInput(intent, orderId));
    return { intent, link };
  }
  it("reads only the delivery plan of the exact linked shop, order, intent and attempt with worker privileges", async () => {
    const { intent, link } = await linkedForPayment("gid://shopify/Order/7101");
    const worker = postgres(safeUrl(), { max: 1, ssl: false });
    try {
      await worker`SET ROLE bloombox_worker`;
      await worker`SET default_transaction_read_only = on`;
      const query = new PostgresShopifyDeliveryPlanQuery(worker);
      const result = await query.find(link, scope);
      expect(result).toEqual({ deliveryDate: "2026-09-14", status: "CHECKOUT_CREATED", detailsAvailable: true,
        retentionExpiresAt: intent.piiRetentionExpiresAt });
      expect(JSON.stringify(result)).not.toMatch(/テスト宛名|贈る言葉|ciphertext|secret|opaque/);
      for (const candidate of [{ ...link, purchaseIntentId: randomUUID() }, { ...link, attemptId: randomUUID() },
        { ...link, orderId: "gid://shopify/Order/7102" }, { ...link, purchaseIntentId: "not-an-id" }]) {
        expect(await query.find(candidate, scope)).toBeNull();
      }
      expect(await query.find(link, "other.myshopify.com")).toBeNull();
      expect(await query.find(link, "invalid-shop")).toBeNull();
      // Purchase intent TTL is not a payment-provider expiration; preserve the real plan after that TTL.
      await sql`UPDATE bloombox.purchase_intents SET expires_at = created_at + interval '1 hour' WHERE id = ${intent.id}`;
      expect(await query.find(link, scope)).toMatchObject({ status: "CHECKOUT_CREATED", deliveryDate: "2026-09-14" });
      await sql`UPDATE bloombox.purchase_intents SET status = 'EXPIRED', pii_key_id = NULL, recipient_ciphertext = NULL,
        gift_message_ciphertext = NULL, pii_purged_at = clock_timestamp() WHERE id = ${intent.id}`;
      expect(await query.find(link, scope)).toMatchObject({ status: "EXPIRED", detailsAvailable: false });
    } finally { await worker.end({ timeout: 5 }); }
  });
  it("reports a delivery-plan database failure safely without turning it into a missing plan", async () => {
    const { link } = await linkedForPayment("gid://shopify/Order/7201");
    const worker = postgres(safeUrl(), { max: 1, ssl: false });
    try {
      await worker`SET ROLE bloombox_worker`;
      await sql`REVOKE SELECT ON bloombox.shopify_order_links FROM bloombox_worker`;
      try {
        await expect(new PostgresShopifyDeliveryPlanQuery(worker).find(link, scope)).rejects.toEqual(new ShopifyDeliveryPlanUnavailableError());
      } finally { await sql`GRANT SELECT ON bloombox.shopify_order_links TO bloombox_worker`; }
      expect(await new PostgresShopifyDeliveryPlanQuery(worker).find(link, scope)).toMatchObject({ detailsAvailable: true });
    } finally { await worker.end({ timeout: 5 }); }
  });
  const acceptanceTime = new Date("2026-09-11T12:00:00Z");
  const acceptancePolicy: Extract<ShopifyOrderAcceptancePolicy, { approval: "APPROVED" }> = { approval: "APPROVED", testMode: true, taxesIncluded: true,
    coverage: { approval: "APPROVED", prefectures: ["東京都"], excludedPostalPrefixes: [] },
    shippingByProduct: { shopify_test: 1000 }, piiRetentionDays: 90 };
  async function acceptanceInput(orderId: string, taxesIncluded = true): Promise<ShopifyOrderAcceptance> {
    const { link } = await linkedForPayment(orderId);
    const total = taxesIncluded ? 5000 : 5500;
    await new PostgresShopifyPaymentEvidence(sql).record(link, scope, { ...paidSnapshot(), requested: total, received: total,
      transactions: [{ ...saleTransaction, amount: total }] });
    return { ...link, shop: scope, paymentVersion: 1, updatedAt: paidSnapshot().updatedAt, variantId: "gid://shopify/ProductVariant/101",
      pricing: { taxesIncluded, estimatedTaxes: false, edited: false, subtotal: 4000, currentSubtotal: 4000,
        tax: taxesIncluded ? 454 : 500, currentTax: taxesIncluded ? 454 : 500, total, originalTotal: total, currentTotal: total, currentShipping: 1000,
        duties: 0, currentDuties: 0, additionalFees: 0, currentAdditionalFees: 0, tips: 0,
        lines: [{ unitPrice: 4000, quantity: 1, currentQuantity: 1, discounts: [], taxes: [taxesIncluded ? 363 : 400] }],
        shipping: [{ originalPrice: 1000, discountedPrice: 1000, currentDiscountedPrice: 1000, removed: false, taxes: [taxesIncluded ? 91 : 100] }] },
      address: { countryCode: "JP", prefecture: "東京都", postalCode: "100-0001", recipientName: "配送宛名", city: "千代田区",
        addressLine: "秘密の番地", addressLine2: "秘密の建物", phone: "000-0000-0000" } };
  }
  async function acceptanceWorkflow(orderId: string, complete = false, withFulfillment = false) {
    const intent = await prepare(); await flow(intent).useCase.execute(intent.id);
    const config = { storeDomain: scope, accessToken: "synthetic-admin-key", apiVersion: "2026-07" } as const;
    const bag = (amount: number) => ({ shopMoney: { amount: String(amount), currencyCode: "JPY" }, presentmentMoney: { amount: String(amount), currencyCode: "JPY" } });
    const source = { __typename: "Order", id: orderId, updatedAt: paidSnapshot().updatedAt, test: true, cancelledAt: null,
      cartToken: `opaque-${intent.id}`, displayFinancialStatus: "PAID", taxesIncluded: true, estimatedTaxes: false, edited: false,
      originalTotalPriceSet: bag(5000), currentTotalPriceSet: bag(5000), totalPriceSet: bag(5000), totalReceivedSet: bag(5000), totalRefundedSet: bag(0),
      subtotalPriceSet: bag(4000), currentSubtotalPriceSet: bag(4000), totalTaxSet: bag(454), currentTotalTaxSet: bag(454),
      currentShippingPriceSet: bag(1000), originalTotalDutiesSet: null, currentTotalDutiesSet: null,
      originalTotalAdditionalFeesSet: null, currentTotalAdditionalFeesSet: null, totalTipReceivedSet: bag(0),
      transactions: [{ id: `gid://shopify/OrderTransaction/${orderId.split('/').at(-1)}01`, kind: "SALE", status: "SUCCESS", test: true, parentTransaction: null, amountSet: bag(5000) }],
      lineItems: { nodes: [{ id: "gid://shopify/LineItem/1", variant: { id: "gid://shopify/ProductVariant/101" }, quantity: 1, currentQuantity: 1,
        originalUnitPriceSet: bag(4000), discountAllocations: [], taxLines: [{ priceSet: bag(363) }] }], pageInfo: { hasNextPage: false } },
      shippingLines: { nodes: [{ originalPriceSet: bag(1000), discountedPriceSet: bag(1000), currentDiscountedPriceSet: bag(1000),
        isRemoved: false, taxLines: [{ priceSet: bag(91) }] }], pageInfo: { hasNextPage: false } } };
    const destination = { __typename: "Order", id: orderId, updatedAt: source.updatedAt, test: true, cancelledAt: null, requiresShipping: true,
      shippingAddress: { countryCodeV2: "JP", provinceCode: "JP-13", zip: "100-0001", name: "配送先の秘密", city: "千代田区",
        address1: "番地の秘密", address2: "建物の秘密", phone: "+810000000000" } };
    const finalDestination = vi.fn(async () => destination);
    const fulfillmentSource = { __typename: "Order", id: orderId, test: true,
      fulfillmentsCount: { count: 0, precision: "EXACT" }, fulfillments: [] };
    const fulfillmentResponse = vi.fn(async (): Promise<unknown> => fulfillmentSource);
    const respond = (node: unknown) => Response.json({ data: { shop: { myshopifyDomain: scope }, node } }, { headers: { "x-shopify-api-version": config.apiVersion } });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const query = JSON.parse(String(init?.body)).query;
      const node = query.includes("BloomBoxAcceptanceDestination") ? await finalDestination()
        : query.includes("BloomBoxDeliveryDestination") ? destination : source;
      return respond(query.includes("BloomBoxFulfillmentObservation") ? await fulfillmentResponse() : node);
    });
    const reader = new ShopifyAdminOrderReader(config, fetcher, acceptancePolicy.coverage);
    const clock = vi.fn(() => acceptanceTime);
    const orders = new PostgresShopifyOrderAcceptor(sql, protector, acceptancePolicy, clock);
    const intake = new PostgresShopifyFulfillmentIntake(sql, true, { approval: "PENDING" }, clock, reader);
    const completion = { orders: new PostgresShopifyAcceptedOrderQuery(sql), payments: new PostgresShopifyOrderPaymentProjector(sql, true, clock),
      purchases: new PostgresShopifyPurchaseConverter(sql, clock), fulfillment: withFulfillment ? intake : undefined };
    const useCase = new ReconcileShopifyPayment(new ReadShopifyReference(reader), new PostgresShopifyOrderLinker(sql),
      new PostgresShopifyPaymentEvidence(sql), true, new PostgresShopifyDeliveryPlanQuery(sql), reader, clock,
      new ShopifyAdminOrderAcceptor(reader, orders, acceptancePolicy), complete ? completion : undefined);
    const event = { provider: "SHOPIFY" as const, providerAccountId: scope, eventType: "shopify.order.changed",
      externalEventId: `synthetic-${orderId}`, externalObjectId: orderId, apiVersion: config.apiVersion, occurredAt: acceptanceTime,
      payload: { id: orderId, objectType: "shopify_order_reference", shippingAddress: { address2: "forged-address" } } };
    return { intent, useCase, event, finalDestination, destination, clock, source, fetcher, respond, completion, intake, reader, fulfillmentSource, fulfillmentResponse };
  }
  function fulfillmentNode(fixture: Awaited<ReturnType<typeof acceptanceWorkflow>>, delivered = false) {
    return { ...fixture.fulfillmentSource, fulfillmentsCount: { count: 1, precision: "EXACT" },
      fulfillments: [{ id: "gid://shopify/Fulfillment/8801", order: { id: fixture.event.externalObjectId }, status: "SUCCESS",
        updatedAt: "2026-09-11T12:00:00Z", inTransitAt: "2026-09-11T10:00:00Z", deliveredAt: delivered ? "2026-09-11T11:00:00Z" : null }] };
  }
  it("retains provider activity across concurrent reads, late empty responses and cancellation without projecting a whole shipment", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8081", true, true);
    fixture.fulfillmentResponse.mockResolvedValue(fulfillmentNode(fixture));
    const results = await Promise.all(Array.from({ length: 6 }, () => fixture.useCase.execute(fixture.event)));
    expect(results.filter((result) => result.completion.outcome === "COMPLETED" && result.completion.fulfillment.outcome === "APPLIED")).toHaveLength(1);
    expect(results[0]).toMatchObject({ completion: { fulfillment: { providerActivity: "IN_TRANSIT", status: "UNFULFILLED",
      decision: { kind: "HELD", reason: "EXTERNAL_FULFILLMENT_REVIEW_REQUIRED" } } } });
    fixture.fulfillmentResponse.mockResolvedValue(fulfillmentNode(fixture, true));
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ completion: { fulfillment: { outcome: "APPLIED", providerActivity: "DELIVERED" } } });
    fixture.fulfillmentResponse.mockResolvedValue(fixture.fulfillmentSource);
    fixture.fetcher.mockImplementation(async (_url, init) => fixture.respond(JSON.parse(String(init?.body)).query.includes("BloomBoxFulfillmentObservation")
      ? await fixture.fulfillmentResponse() : { ...fixture.source, updatedAt: "2026-09-11T13:00:00Z", cancelledAt: "2026-09-11T13:00:00Z" }));
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ completion: { fulfillment: { providerActivity: "DELIVERED", status: "UNFULFILLED", decision: { kind: "HELD" } } } });
    const [intake] = await sql`SELECT * FROM bloombox.shopify_fulfillment_intakes WHERE purchase_intent_id = ${fixture.intent.id}`;
    expect(intake.provider_observation).toMatchObject({ activity: "DELIVERED", witness: { id: "gid://shopify/Fulfillment/8801", deliveredAt: "2026-09-11T11:00:00Z" } });
    expect(await sql`SELECT id FROM bloombox.shipments WHERE fulfillment_id = ${intake.fulfillment_id}`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.fulfillment_status_transitions WHERE fulfillment_id = ${intake.fulfillment_id}`).toHaveLength(1);
    await expect(sql`UPDATE bloombox.shopify_fulfillment_intakes SET version = version + 1,
      provider_observation = '{"activity":"NONE","witness":null}'::jsonb WHERE fulfillment_id = ${intake.fulfillment_id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE bloombox.shopify_fulfillment_intakes SET version = version + 1,
      provider_observation = jsonb_set(provider_observation, '{witness,id}', '"gid://shopify/Fulfillment/8802"'::jsonb)
      WHERE fulfillment_id = ${intake.fulfillment_id}`).rejects.toMatchObject({ code: "23514" });
  });
  it("preserves completed payment on provider failure and holds cancellation when the reader is missing", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8082", true, true);
    fixture.fulfillmentResponse.mockRejectedValue(new Error("private-provider-details"));
    await expect(fixture.useCase.execute(fixture.event)).rejects.toEqual(new ShopifyFulfillmentIntakeError());
    expect((await sql`SELECT status FROM bloombox.purchase_intents WHERE id = ${fixture.intent.id}`)[0].status).toBe("CONVERTED");
    expect(await sql`SELECT fulfillment_id FROM bloombox.shopify_fulfillment_intakes WHERE purchase_intent_id = ${fixture.intent.id}`).toHaveLength(0);
    fixture.fulfillmentResponse.mockResolvedValue(fixture.fulfillmentSource);
    await fixture.useCase.execute(fixture.event);
    const accepted = await fixture.completion.orders.find(scope, fixture.event.externalObjectId);
    if (!accepted) throw new Error("Expected accepted order");
    const input = { ...accepted, shop: scope, externalOrderId: fixture.event.externalObjectId };
    // A past empty read must not become a permanent permission to cancel.
    expect(await new PostgresShopifyFulfillmentIntake(sql, true).reconcile(input))
      .toMatchObject({ status: "UNFULFILLED", providerActivity: "UNVERIFIED", decision: { kind: "HELD", reason: "PROVIDER_FULFILLMENT_UNVERIFIED" } });
    fixture.fulfillmentResponse.mockResolvedValue({ ...fixture.fulfillmentSource, test: false });
    await expect(fixture.intake.reconcile(input)).rejects.toEqual(new ShopifyFulfillmentIntakeError());
    fixture.fulfillmentResponse.mockResolvedValue(fulfillmentNode(fixture));
    expect(await fixture.intake.reconcile(input)).toMatchObject({ providerActivity: "IN_TRANSIT", decision: { kind: "HELD" } });
  });
  it("records a late shipment after local cancellation as a conflict without reopening local state", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8083", true, true);
    await fixture.useCase.execute(fixture.event);
    fixture.fetcher.mockImplementation(async (_url, init) => fixture.respond(JSON.parse(String(init?.body)).query.includes("BloomBoxFulfillmentObservation")
      ? await fixture.fulfillmentResponse() : { ...fixture.source, updatedAt: "2026-09-11T13:00:00Z", cancelledAt: "2026-09-11T13:00:00Z" }));
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ completion: { fulfillment: { status: "CANCELLED", decision: { kind: "CANCELLED" } } } });
    fixture.fulfillmentResponse.mockResolvedValue(fulfillmentNode(fixture, true));
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ completion: { fulfillment: { status: "CANCELLED", providerActivity: "DELIVERED",
      decision: { kind: "HELD", reason: "EXTERNAL_FULFILLMENT_REVIEW_REQUIRED" } } } });
  });
  it("rolls back the observation and audit together on an outbox failure then retries once", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8084", true, true);
    await fixture.useCase.execute(fixture.event);
    fixture.fulfillmentResponse.mockResolvedValue(fulfillmentNode(fixture, true));
    const [before] = await sql`SELECT * FROM bloombox.shopify_fulfillment_intakes WHERE purchase_intent_id = ${fixture.intent.id}`;
    await sql.unsafe(`CREATE FUNCTION bloombox.test_observation_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type = 'fulfillment.shopify_intake.updated' THEN RAISE EXCEPTION 'observation fault'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_observation_failure BEFORE INSERT ON bloombox.outbox_events FOR EACH ROW EXECUTE FUNCTION bloombox.test_observation_failure();`);
    try {
      await expect(fixture.useCase.execute(fixture.event)).rejects.toEqual(new ShopifyFulfillmentIntakeError());
      expect((await sql`SELECT * FROM bloombox.shopify_fulfillment_intakes WHERE fulfillment_id = ${before.fulfillment_id}`)[0]).toEqual(before);
      expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${before.fulfillment_id}`).toHaveLength(1);
    } finally { await sql.unsafe("DROP TRIGGER test_observation_failure ON bloombox.outbox_events; DROP FUNCTION bloombox.test_observation_failure()"); }
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ completion: { fulfillment: { outcome: "APPLIED", providerActivity: "DELIVERED" } } });
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ completion: { fulfillment: { outcome: "DUPLICATE", providerActivity: "DELIVERED" } } });
    expect(await sql`SELECT id FROM bloombox.outbox_events WHERE aggregate_id = ${before.fulfillment_id}`).toHaveLength(2);
  });
  it("records one held fulfillment, updates time-based holds and cancels untouched intake on full refund", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8031", true, true);
    const results = await Promise.all(Array.from({ length: 6 }, () => fixture.useCase.execute(fixture.event)));
    const [intake] = await sql`SELECT * FROM bloombox.shopify_fulfillment_intakes WHERE purchase_intent_id = ${fixture.intent.id}`;
    expect(intake).toMatchObject({ decision: "HELD", reason_code: "POLICY_NOT_APPROVED", observed_status: "UNFULFILLED", version: "1" });
    expect(results.filter((result) => result.completion.outcome === "COMPLETED" && result.completion.fulfillment.outcome === "APPLIED")).toHaveLength(1);
    expect(await sql`SELECT id FROM bloombox.fulfillments WHERE order_id = ${intake.order_id}`).toHaveLength(1);
    expect(await sql`SELECT id FROM bloombox.outbox_events WHERE aggregate_id = ${intake.fulfillment_id}`).toHaveLength(1);
    fixture.clock.mockReturnValue(new Date("2026-09-11T15:00:00Z"));
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ completion: { fulfillment: { decision: { kind: "HELD", reason: "DELIVERY_UNAVAILABLE" } } } });
    expect((await sql`SELECT version, payment_evidence_version FROM bloombox.shopify_fulfillment_intakes WHERE fulfillment_id = ${intake.fulfillment_id}`)[0])
      .toEqual({ version: "2", payment_evidence_version: 1 });
    const bag = (amount: number) => ({ shopMoney: { amount: String(amount), currencyCode: "JPY" }, presentmentMoney: { amount: String(amount), currencyCode: "JPY" } });
    const refunded = { ...fixture.source, updatedAt: "2026-09-11T11:00:00Z", totalRefundedSet: bag(5000), currentTotalPriceSet: bag(0),
      transactions: [...fixture.source.transactions, { id: "gid://shopify/OrderTransaction/803102", kind: "REFUND", status: "SUCCESS", test: true,
        parentTransaction: { id: fixture.source.transactions[0].id }, amountSet: bag(5000) }] };
    fixture.fetcher.mockImplementation(async (_url, init) => fixture.respond(JSON.parse(String(init?.body)).query.includes("BloomBoxFulfillmentObservation") ? await fixture.fulfillmentResponse() : refunded));
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ completion: { fulfillment: { status: "CANCELLED", decision: { kind: "CANCELLED", reason: "FULLY_REFUNDED" } } } });
    fixture.fetcher.mockImplementation(async (_url, init) => fixture.respond(JSON.parse(String(init?.body)).query.includes("BloomBoxFulfillmentObservation") ? await fixture.fulfillmentResponse() : fixture.source));
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ outcome: "STALE", completion: { fulfillment: { outcome: "DUPLICATE", status: "CANCELLED" } } });
    expect(await sql`SELECT id FROM bloombox.fulfillment_status_transitions WHERE fulfillment_id = ${intake.fulfillment_id}`).toHaveLength(2);
    expect(await sql`SELECT id FROM bloombox.shipments WHERE fulfillment_id = ${intake.fulfillment_id}`).toHaveLength(0);
    const audits = await sql`SELECT safe_metadata FROM bloombox.audit_logs WHERE resource_id = ${intake.fulfillment_id}`;
    expect(JSON.stringify([results, audits])).not.toMatch(/秘密|1000001|810000|ciphertext/);
    await expect(sql`DELETE FROM bloombox.shopify_fulfillment_intakes WHERE fulfillment_id = ${intake.fulfillment_id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE bloombox.shopify_fulfillment_intakes SET payment_evidence_version = 1, version = version + 1 WHERE fulfillment_id = ${intake.fulfillment_id}`).rejects.toMatchObject({ code: "23514" });
  });
  it.each(["SCHEDULED", "PROCESSING", "READY", "SHIPPED", "DELIVERED", "RETURNED"])("preserves %s on provider cancellation and records review instead", async (status) => {
    const fixture = await acceptanceWorkflow(`gid://shopify/Order/8032${["SCHEDULED", "PROCESSING", "READY", "SHIPPED", "DELIVERED", "RETURNED"].indexOf(status)}`, true, true);
    await fixture.useCase.execute(fixture.event);
    const [intake] = await sql`SELECT * FROM bloombox.shopify_fulfillment_intakes WHERE purchase_intent_id = ${fixture.intent.id}`;
    await sql`UPDATE bloombox.fulfillments SET status = ${status}, version = version + 1 WHERE id = ${intake.fulfillment_id}`;
    fixture.fetcher.mockImplementation(async (_url, init) => fixture.respond(JSON.parse(String(init?.body)).query.includes("BloomBoxFulfillmentObservation") ? await fixture.fulfillmentResponse() : { ...fixture.source, updatedAt: "2026-09-11T11:00:00Z", cancelledAt: "2026-09-11T11:00:00Z" }));
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ completion: { fulfillment: { status,
      decision: { kind: "HELD", reason: ["SHIPPED", "DELIVERED", "RETURNED"].includes(status) ? "POST_SHIPMENT_REVIEW_REQUIRED" : "ACTIVE_FULFILLMENT_REVIEW_REQUIRED" } } } });
    expect((await sql`SELECT status FROM bloombox.fulfillments WHERE id = ${intake.fulfillment_id}`)[0].status).toBe(status);
    expect(await sql`SELECT id FROM bloombox.fulfillment_status_transitions WHERE fulfillment_id = ${intake.fulfillment_id}`).toHaveLength(1);
  });
  it("rolls back failed intake but preserves completed purchase/payment and resumes with worker privileges", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8033", true, true);
    await sql.unsafe(`CREATE FUNCTION bloombox.test_intake_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type = 'fulfillment.shopify_intake.updated' THEN RAISE EXCEPTION 'intake fault'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_intake_failure BEFORE INSERT ON bloombox.outbox_events FOR EACH ROW EXECUTE FUNCTION bloombox.test_intake_failure();`);
    try {
      await expect(fixture.useCase.execute(fixture.event)).rejects.toEqual(new ShopifyFulfillmentIntakeError());
      expect((await sql`SELECT status FROM bloombox.purchase_intents WHERE id = ${fixture.intent.id}`)[0].status).toBe("CONVERTED");
      expect(await sql`SELECT fulfillment_id FROM bloombox.shopify_fulfillment_intakes WHERE purchase_intent_id = ${fixture.intent.id}`).toHaveLength(0);
      expect(await sql`SELECT id FROM bloombox.fulfillments WHERE order_id IN (SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${fixture.intent.id})`).toHaveLength(0);
    } finally { await sql.unsafe("DROP TRIGGER test_intake_failure ON bloombox.outbox_events; DROP FUNCTION bloombox.test_intake_failure()"); }
    const accepted = await fixture.completion.orders.find(scope, fixture.event.externalObjectId);
    if (!accepted) throw new Error("Expected order");
    const input = { ...accepted, shop: scope, externalOrderId: fixture.event.externalObjectId };
    const worker = postgres(safeUrl(), { max: 1, ssl: false });
    try {
      await worker`SET ROLE bloombox_worker`;
      const intake = new PostgresShopifyFulfillmentIntake(worker, true, { approval: "APPROVED" }, () => acceptanceTime, fixture.reader);
      expect(await intake.reconcile(input)).toMatchObject({ outcome: "APPLIED", decision: { kind: "HELD", reason: "INVENTORY_UNVERIFIED" } });
      expect(await intake.reconcile(input)).toMatchObject({ outcome: "DUPLICATE" });
      for (const override of [{ orderId: randomUUID() }, { attemptId: randomUUID() }, { shop: "other.myshopify.com" }]) {
        await expect(intake.reconcile({ ...input, ...override })).rejects.toEqual(new ShopifyFulfillmentIntakeError());
      }
      await expect(new PostgresShopifyFulfillmentIntake(worker, false).reconcile(input)).rejects.toEqual(new ShopifyFulfillmentIntakeError());
      expect((await sql`SELECT has_table_privilege('bloombox_application', 'bloombox.shopify_fulfillment_intakes', 'INSERT') AS app_write,
        has_table_privilege('bloombox_worker', 'bloombox.shopify_fulfillment_intakes', 'DELETE') AS worker_delete,
        has_column_privilege('bloombox_worker', 'bloombox.fulfillments', 'order_id', 'UPDATE') AS reassign_order`)[0])
        .toEqual({ app_write: false, worker_delete: false, reassign_order: false });
    } finally { await worker.end({ timeout: 5 }); }
  });
  it("rejects stale payment projections and holds pending refund transactions after projection catches up", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8034", true, true);
    await fixture.useCase.execute(fixture.event);
    const accepted = await fixture.completion.orders.find(scope, fixture.event.externalObjectId);
    if (!accepted) throw new Error("Expected order");
    const input = { ...accepted, shop: scope, externalOrderId: fixture.event.externalObjectId };
    const sale = { ...saleTransaction, id: fixture.source.transactions[0].id, amount: 5000 };
    await new PostgresShopifyPaymentEvidence(sql).record({ ...accepted, orderId: fixture.event.externalObjectId }, scope,
      { updatedAt: "2026-09-11T11:00:00Z", test: true, cancelledAt: null, requested: 5000, received: 5000, refunded: 0,
        transactions: [sale, { id: "gid://shopify/OrderTransaction/803402", kind: "REFUND", status: "PENDING", amount: 500, parentId: sale.id }] });
    await expect(fixture.intake.reconcile(input)).rejects.toEqual(new ShopifyFulfillmentIntakeError());
    expect((await sql`SELECT version FROM bloombox.shopify_fulfillment_intakes WHERE order_id = ${accepted.orderId}`)[0].version).toBe("1");
    await fixture.completion.payments.project(input);
    expect(await fixture.intake.reconcile(input)).toMatchObject({ decision: { kind: "HELD", reason: "PAYMENT_PENDING" } });
  });
  it("completes accepted orders once and projects refunds after conversion, PII purge and edited cart contents", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8041", true);
    const results = await Promise.all(Array.from({ length: 6 }, () => fixture.useCase.execute(fixture.event)));
    expect(results.every((result) => result.completion.outcome === "COMPLETED")).toBe(true);
    expect(results.filter((result) => result.completion.outcome === "COMPLETED" && result.completion.purchase.outcome === "CONVERTED")).toHaveLength(1);
    const accepted = await fixture.completion.orders.find(scope, fixture.event.externalObjectId);
    if (!accepted) throw new Error("Expected accepted order");
    expect(await fixture.completion.orders.find("other.myshopify.com", fixture.event.externalObjectId)).toBeNull();
    const [payment] = await sql`SELECT * FROM bloombox.payments WHERE order_id = ${accepted.orderId}`;
    expect(payment).toMatchObject({ status: "CAPTURED", amount_captured_minor: "5000", amount_authorized_minor: "5000" });
    expect(await sql`SELECT id FROM bloombox.financial_transactions WHERE payment_id = ${payment.id}`).toHaveLength(1);
    await new PostgresDataRetentionJob(sql).execute(new Date("2026-11-11T00:00:00Z"));
    expect((await sql`SELECT status, recipient_ciphertext FROM bloombox.purchase_intents WHERE id = ${fixture.intent.id}`)[0])
      .toEqual({ status: "CONVERTED", recipient_ciphertext: null });
    const bag = (amount: number) => ({ shopMoney: { amount: String(amount), currencyCode: "JPY" }, presentmentMoney: { amount: String(amount), currencyCode: "JPY" } });
    const refund = { id: "gid://shopify/OrderTransaction/7002", kind: "REFUND", status: "SUCCESS", test: true,
      parentTransaction: { id: fixture.source.transactions[0].id }, amountSet: bag(500) };
    const changed = { ...fixture.source, updatedAt: "2026-09-11T11:00:00Z", cartToken: null, edited: true,
      totalRefundedSet: bag(500), currentTotalPriceSet: bag(4500),
      lineItems: { ...fixture.source.lineItems, nodes: fixture.source.lineItems.nodes.map((line) => ({ ...line, variant: null })) },
      transactions: [...fixture.source.transactions, refund] };
    fixture.fetcher.mockImplementation(async () => fixture.respond(changed));
    const before = fixture.fetcher.mock.calls.length;
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ acceptance: { outcome: "DUPLICATE" },
      completion: { outcome: "COMPLETED", payment: { status: "PARTIALLY_REFUNDED" }, purchase: { outcome: "DUPLICATE" } } });
    expect(fixture.fetcher.mock.calls.length - before).toBe(1); // No new address read after acceptance.
    const fullyRefunded = { ...changed, updatedAt: "2026-09-11T12:00:00Z", totalRefundedSet: bag(5000), currentTotalPriceSet: bag(0),
      transactions: [...changed.transactions, { ...refund, id: "gid://shopify/OrderTransaction/7003", amountSet: bag(4500) }] };
    fixture.fetcher.mockImplementation(async () => fixture.respond(fullyRefunded));
    await fixture.useCase.execute(fixture.event);
    fixture.fetcher.mockImplementation(async () => fixture.respond(fixture.source));
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ outcome: "STALE", completion: { payment: { outcome: "DUPLICATE", status: "REFUNDED" } } });
    expect((await sql`SELECT status, amount_refunded_minor FROM bloombox.payments WHERE id = ${payment.id}`)[0])
      .toEqual({ status: "REFUNDED", amount_refunded_minor: "5000" });
    const balances = await sql`SELECT financial_transaction_id, sum(signed_amount_minor)::text AS balance, count(*)::int AS count
      FROM bloombox.ledger_entries WHERE financial_transaction_id IN (SELECT id FROM bloombox.financial_transactions WHERE payment_id = ${payment.id})
      GROUP BY financial_transaction_id`;
    expect(balances).toHaveLength(3); expect(balances.every((row) => row.balance === "0" && row.count === 2)).toBe(true);
    expect(await sql`SELECT id FROM bloombox.outbox_events WHERE aggregate_id = ${fixture.intent.id} AND event_type = 'checkout.shopify_purchase.converted'`).toHaveLength(1);
    expect(await sql`SELECT id FROM bloombox.fulfillments WHERE order_id = ${accepted.orderId}`).toHaveLength(0);
    await expect(sql`UPDATE bloombox.shopify_payment_projections SET evidence_version = 1 WHERE order_id = ${accepted.orderId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM bloombox.shopify_payment_projections WHERE order_id = ${accepted.orderId}`).rejects.toMatchObject({ code: "23514" });
  });
  it("resumes committed order/payment stages after conversion failure without re-reading protected fields", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8042", true);
    await sql.unsafe(`CREATE FUNCTION bloombox.test_conversion_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type = 'checkout.shopify_purchase.converted' THEN RAISE EXCEPTION 'conversion fault'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_conversion_failure BEFORE INSERT ON bloombox.outbox_events FOR EACH ROW EXECUTE FUNCTION bloombox.test_conversion_failure();`);
    try {
      await expect(fixture.useCase.execute(fixture.event)).rejects.toEqual(new ShopifyPurchaseConversionError());
      expect((await sql`SELECT status FROM bloombox.purchase_intents WHERE id = ${fixture.intent.id}`)[0].status).toBe("CHECKOUT_CREATED");
      expect(await sql`SELECT payment_id FROM bloombox.shopify_payment_projections WHERE purchase_intent_id = ${fixture.intent.id}`).toHaveLength(1);
    } finally { await sql.unsafe("DROP TRIGGER test_conversion_failure ON bloombox.outbox_events; DROP FUNCTION bloombox.test_conversion_failure()"); }
    fixture.clock.mockReturnValue(new Date("2026-11-11T00:00:00Z"));
    fixture.finalDestination.mockRejectedValue(new Error("must not fetch address"));
    expect(await fixture.useCase.execute(fixture.event)).toMatchObject({ acceptance: { outcome: "DUPLICATE" },
      completion: { payment: { outcome: "DUPLICATE" }, purchase: { outcome: "CONVERTED" } } });
    const target = await fixture.completion.orders.find(scope, fixture.event.externalObjectId);
    if (!target) throw new Error("Expected receipt");
    const input = { ...target, shop: scope, externalOrderId: fixture.event.externalObjectId };
    for (const override of [{ orderId: randomUUID() }, { attemptId: randomUUID() }, { shop: "wrong.myshopify.com" }]) {
      await expect(fixture.completion.purchases.convert({ ...input, ...override })).rejects.toEqual(new ShopifyPurchaseConversionError());
      await expect(fixture.completion.payments.project({ ...input, ...override })).rejects.toEqual(new ShopifyOrderPaymentProjectionError());
    }
  });
  it("rolls back payment, ledger and projection on outbox failure and retries with worker privileges", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8043");
    await fixture.useCase.execute(fixture.event);
    const accepted = await fixture.completion.orders.find(scope, fixture.event.externalObjectId);
    if (!accepted) throw new Error("Expected receipt");
    const input = { ...accepted, shop: scope, externalOrderId: fixture.event.externalObjectId };
    await expect(fixture.completion.purchases.convert(input)).rejects.toEqual(new ShopifyPurchaseConversionError());
    const worker = postgres(safeUrl(), { max: 1, ssl: false });
    try {
      await worker`SET ROLE bloombox_worker`;
      const projector = new PostgresShopifyOrderPaymentProjector(worker, true);
      await sql`REVOKE INSERT ON bloombox.outbox_events FROM bloombox_worker`;
      try {
        await expect(projector.project(input)).rejects.toEqual(new ShopifyOrderPaymentProjectionError());
        expect(await sql`SELECT id FROM bloombox.payments WHERE order_id = ${accepted.orderId}`).toHaveLength(0);
        expect(await sql`SELECT id FROM bloombox.financial_transactions WHERE order_id = ${accepted.orderId}`).toHaveLength(0);
        expect(await sql`SELECT payment_id FROM bloombox.shopify_payment_projections WHERE order_id = ${accepted.orderId}`).toHaveLength(0);
      } finally { await sql`GRANT INSERT ON bloombox.outbox_events TO bloombox_worker`; }
      expect(await projector.project(input)).toMatchObject({ outcome: "APPLIED", status: "CAPTURED" });
      expect(await new PostgresShopifyPurchaseConverter(worker).convert(input)).toEqual({ outcome: "CONVERTED" });
      expect(await projector.project(input)).toMatchObject({ outcome: "DUPLICATE" });
      expect(await new PostgresShopifyAcceptedOrderQuery(worker).find(scope, fixture.event.externalObjectId)).toEqual(accepted);
      await expect(new PostgresShopifyOrderPaymentProjector(worker, false).project(input)).rejects.toEqual(new ShopifyOrderPaymentProjectionError());
    } finally { await worker.end({ timeout: 5 }); }
  });
  it("uses the latest refund facts when payment is first projected after acceptance", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8044");
    await fixture.useCase.execute(fixture.event);
    const accepted = await fixture.completion.orders.find(scope, fixture.event.externalObjectId);
    if (!accepted) throw new Error("Expected accepted order");
    const input = { ...accepted, shop: scope, externalOrderId: fixture.event.externalObjectId };
    const sale = { ...saleTransaction, id: fixture.source.transactions[0].id, amount: 5000 };
    await new PostgresShopifyPaymentEvidence(sql).record({ ...accepted, orderId: fixture.event.externalObjectId }, scope,
      { updatedAt: "2026-09-11T11:00:00Z", test: true, cancelledAt: null, requested: 5000, received: 5000, refunded: 5000,
        transactions: [sale, { id: "gid://shopify/OrderTransaction/804402", kind: "REFUND", status: "SUCCEEDED", amount: 5000, parentId: sale.id }] });
    expect(await fixture.completion.payments.project(input)).toMatchObject({ outcome: "APPLIED", status: "REFUNDED", version: 2 });
    expect(await fixture.completion.payments.project(input)).toMatchObject({ outcome: "DUPLICATE", status: "REFUNDED", version: 2 });
    expect(await fixture.completion.purchases.convert(input)).toEqual({ outcome: "CONVERTED" });
    expect(await sql`SELECT id FROM bloombox.financial_transactions WHERE order_id = ${accepted.orderId}`).toHaveLength(2);
    await expect(sql`UPDATE bloombox.shopify_payment_projections SET order_id = ${randomUUID()}, evidence_version = 3
      WHERE order_id = ${accepted.orderId}`).rejects.toMatchObject({ code: "23514" });
    const [permissions] = await sql`SELECT
      has_table_privilege('bloombox_application', 'bloombox.shopify_payment_projections', 'INSERT') AS app_write,
      has_table_privilege('bloombox_worker', 'bloombox.shopify_payment_projections', 'DELETE') AS worker_delete,
      has_table_privilege('bloombox_readonly', 'bloombox.shopify_payment_projections', 'UPDATE') AS readonly_write`;
    expect(permissions).toEqual({ app_write: false, worker_delete: false, readonly_write: false });
  });
  it("connects authenticated provider reads to durable acceptance and recovers after protected-data failure", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8051");
    fixture.finalDestination.mockRejectedValueOnce(new Error("配送先の秘密"));
    await expect(fixture.useCase.execute(fixture.event)).rejects.toEqual(new ShopifyDeliveryDestinationUnavailableError());
    expect((await sql`SELECT status, version FROM bloombox.shopify_payment_evidence WHERE purchase_intent_id = ${fixture.intent.id}`)[0])
      .toEqual({ status: "CAPTURED", version: 1 });
    expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${fixture.intent.id}`).toHaveLength(0);
    const result = await fixture.useCase.execute(fixture.event);
    expect(result).toMatchObject({ outcome: "DUPLICATE", acceptance: { outcome: "CREATED" } });
    if (result.acceptance.outcome === "HELD") throw new Error("Expected accepted workflow order");
    const { orderId } = result.acceptance;
    const repeats = await Promise.all(Array.from({ length: 6 }, () => fixture.useCase.execute(fixture.event)));
    expect(repeats.every((repeat) => repeat.acceptance.outcome === "DUPLICATE")).toBe(true);
    expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${fixture.intent.id}`).toHaveLength(1);
    const [gift] = await sql`SELECT pii_key_id, address_ciphertext FROM bloombox.order_gift_snapshots WHERE order_id = ${orderId}`;
    const address = JSON.parse(protector.unprotect({ keyId: gift.pii_key_id, ciphertext: gift.address_ciphertext }, `order:${orderId}:address:v1`));
    expect(address).toMatchObject({ addressLine2: "建物の秘密", phone: "+810000000000", postalCode: "1000001" });
    const audits = await sql`SELECT safe_metadata FROM bloombox.audit_logs WHERE resource_id = ${orderId}`;
    const events = await sql`SELECT payload FROM bloombox.outbox_events WHERE aggregate_id = ${orderId}`;
    expect(audits).toHaveLength(1); expect(events).toHaveLength(1);
    expect(JSON.stringify([result, repeats, audits, events])).not.toMatch(/秘密|810000|forged-address|1000001/);
  });
  it("holds changed provider data and a delivery cutoff crossed during the final address read", async () => {
    const fixture = await acceptanceWorkflow("gid://shopify/Order/8052");
    fixture.finalDestination.mockResolvedValueOnce({ ...fixture.destination, updatedAt: "2026-09-11T10:00:01Z" });
    expect((await fixture.useCase.execute(fixture.event)).acceptance).toEqual({ outcome: "HELD", reason: "ORDER_CHANGED" });
    fixture.finalDestination.mockImplementationOnce(async () => {
      fixture.clock.mockReturnValue(new Date("2026-09-11T15:00:00Z")); return fixture.destination;
    });
    expect((await fixture.useCase.execute(fixture.event)).acceptance).toEqual({ outcome: "HELD", reason: "DELIVERY_UNAVAILABLE" });
    expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${fixture.intent.id}`).toHaveLength(0);
    expect((await sql`SELECT status, version FROM bloombox.shopify_payment_evidence WHERE purchase_intent_id = ${fixture.intent.id}`)[0])
      .toEqual({ status: "CAPTURED", version: 1 });
  });
  it("accepts one real order with immutable tax evidence and encrypted gift/address snapshots across concurrent retries", async () => {
    const input = await acceptanceInput("gid://shopify/Order/8101");
    const writer = new PostgresShopifyOrderAcceptor(sql, protector, acceptancePolicy, () => acceptanceTime);
    const results = await Promise.all(Array.from({ length: 6 }, () => writer.accept(input)));
    expect(results.filter((result) => result.outcome === "CREATED")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "DUPLICATE")).toHaveLength(5);
    const result = results[0]; if (result.outcome === "HELD") throw new Error("Expected accepted test order");
    const orders = await sql`SELECT * FROM bloombox.orders WHERE id = ${result.orderId}`;
    expect(orders[0]).toMatchObject({ status: "CONFIRMED", subtotal_minor: "4000", tax_minor: "0", included_tax_minor: "454",
      shipping_minor: "1000", discount_minor: "0", total_minor: "5000", buyer_id: null });
    const items = await sql`SELECT * FROM bloombox.order_items WHERE order_id = ${result.orderId}`;
    expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ tax_minor: "0", included_tax_minor: "363", line_total_minor: "4000" });
    const gifts = await sql`SELECT * FROM bloombox.order_gift_snapshots WHERE order_id = ${result.orderId}`;
    const gift = gifts[0];
    expect(protector.unprotect({ keyId: gift.pii_key_id, ciphertext: gift.address_ciphertext }, `order:${result.orderId}:address:v1`)).toContain("秘密の建物");
    expect(protector.unprotect({ keyId: gift.pii_key_id, ciphertext: gift.recipient_ciphertext }, `order:${result.orderId}:recipient:v1`)).toContain("テスト宛名");
    expect(protector.unprotect({ keyId: gift.pii_key_id, ciphertext: gift.gift_message_ciphertext }, `order:${result.orderId}:gift-message:v1`)).toBe("贈る言葉");
    expect(() => protector.unprotect({ keyId: gift.pii_key_id, ciphertext: gift.address_ciphertext }, "wrong-order-context")).toThrow();
    expect(gift.retention_expires_at).toEqual(new Date(acceptanceTime.getTime() + 90 * 86400000));
    const receipts = await sql`SELECT * FROM bloombox.shopify_order_acceptances WHERE order_id = ${result.orderId}`;
    const audits = await sql`SELECT safe_metadata FROM bloombox.audit_logs WHERE resource_id = ${result.orderId}`;
    const events = await sql`SELECT payload FROM bloombox.outbox_events WHERE aggregate_id = ${result.orderId}`;
    expect(receipts).toHaveLength(1); expect(audits).toHaveLength(1); expect(events).toHaveLength(1);
    expect(receipts[0].price_snapshot.delivery.includedTax).toBe(91);
    expect(JSON.stringify([results, orders, items, gifts, receipts, audits, events])).not.toMatch(/秘密の|配送宛名|贈る言葉|テスト宛名|100-0001|000-0000/);
    expect((await sql`SELECT status FROM bloombox.purchase_intents WHERE id = ${input.purchaseIntentId}`)[0].status).toBe("CHECKOUT_CREATED");
    expect(await sql`SELECT id FROM bloombox.payments WHERE order_id = ${result.orderId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.fulfillments WHERE order_id = ${result.orderId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.order_status_transitions WHERE order_id = ${result.orderId}`).toHaveLength(1);
    await expect(sql`UPDATE bloombox.shopify_order_acceptances SET price_snapshot = '{}'::jsonb WHERE order_id = ${result.orderId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM bloombox.shopify_order_acceptances WHERE order_id = ${result.orderId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE bloombox.order_items SET included_tax_minor = 4001 WHERE order_id = ${result.orderId}`).rejects.toMatchObject({ code: "23514" });
    await new PostgresShopifyPaymentEvidence(sql).record(input, scope, { ...refundedSnapshot(), requested: 5000, received: 5000,
      transactions: [{ ...saleTransaction, amount: 5000 }, refundedSnapshot().transactions[1]] });
    expect(await writer.accept(input)).toEqual({ outcome: "DUPLICATE", orderId: result.orderId, displayId: result.displayId });
    expect(await sql`SELECT * FROM bloombox.shopify_order_acceptances WHERE order_id = ${result.orderId}`).toEqual(receipts);
  });
  it("preserves exclusive merchandise and shipping tax separately without adding either twice", async () => {
    const input = await acceptanceInput("gid://shopify/Order/8151", false);
    const writer = new PostgresShopifyOrderAcceptor(sql, protector, { ...acceptancePolicy, taxesIncluded: false }, () => acceptanceTime);
    const result = await writer.accept(input); if (result.outcome === "HELD") throw new Error("Expected exclusive test order");
    expect((await sql`SELECT tax_minor, included_tax_minor, total_minor FROM bloombox.orders WHERE id = ${result.orderId}`)[0])
      .toEqual({ tax_minor: "500", included_tax_minor: "0", total_minor: "5500" });
    expect((await sql`SELECT tax_minor, included_tax_minor, line_total_minor FROM bloombox.order_items WHERE order_id = ${result.orderId}`)[0])
      .toEqual({ tax_minor: "400", included_tax_minor: "0", line_total_minor: "4400" });
    expect((await sql`SELECT price_snapshot FROM bloombox.shopify_order_acceptances WHERE order_id = ${result.orderId}`)[0].price_snapshot.delivery)
      .toMatchObject({ additionalTax: 100, includedTax: 0, total: 1100 });
  });
  it("keeps terms/coverage, pricing, source version, payment and delivery failures out of accepted orders", async () => {
    const input = await acceptanceInput("gid://shopify/Order/8201");
    const writer = new PostgresShopifyOrderAcceptor(sql, protector, acceptancePolicy, () => acceptanceTime);
    expect(await new PostgresShopifyOrderAcceptor(sql, protector).accept(input)).toEqual({ outcome: "HELD", reason: "TERMS_NOT_APPROVED" });
    expect(await writer.accept({ ...input, paymentVersion: 2 })).toEqual({ outcome: "HELD", reason: "STALE_PAYMENT" });
    expect(await writer.accept({ ...input, address: { ...input.address, countryCode: "US" } })).toEqual({ outcome: "HELD", reason: "ADDRESS_UNRESOLVED" });
    expect(await writer.accept({ ...input, pricing: { ...input.pricing, tax: 455, currentTax: 455 } })).toEqual({ outcome: "HELD", reason: "PRICING_UNRESOLVED" });
    const mismatched = { ...acceptancePolicy, approval: "APPROVED" as const, testMode: false };
    expect(await new PostgresShopifyOrderAcceptor(sql, protector, mismatched, () => acceptanceTime).accept(input)).toEqual({ outcome: "HELD", reason: "TERMS_MISMATCH" });
    expect(await new PostgresShopifyOrderAcceptor(sql, protector, { ...acceptancePolicy, shippingByProduct: { shopify_test: 0 } }, () => acceptanceTime).accept(input))
      .toEqual({ outcome: "HELD", reason: "TERMS_MISMATCH" });
    expect(await writer.accept({ ...input, pricing: { ...input.pricing, subtotal: 3500, currentSubtotal: 3500,
      total: 4500, currentTotal: 4500, originalTotal: 4500, lines: [{ ...input.pricing.lines[0], discounts: [500] }] } }))
      .toEqual({ outcome: "HELD", reason: "DISCOUNTS_UNSUPPORTED" });
    for (const override of [{ attemptId: randomUUID() }, { shop: "other.myshopify.com" }, { orderId: "gid://shopify/Order/8202" }, { variantId: "gid://shopify/ProductVariant/999" }]) {
      await expect(writer.accept({ ...input, ...override })).rejects.toBeInstanceOf(ShopifyOrderAcceptanceConflictError);
    }
    expect(await new PostgresShopifyOrderAcceptor(sql, protector, acceptancePolicy, () => new Date("2026-09-11T15:00:00Z")).accept(input))
      .toEqual({ outcome: "HELD", reason: "DELIVERY_UNAVAILABLE" });
    expect(await new PostgresShopifyOrderAcceptor(sql, protector, acceptancePolicy, () => new Date("2026-10-12T00:00:00Z")).accept(input))
      .toEqual({ outcome: "HELD", reason: "PURCHASE_UNAVAILABLE" });
    await sql`UPDATE bloombox.shopify_payment_evidence SET status = 'PARTIALLY_REFUNDED', refunded_minor = 500 WHERE purchase_intent_id = ${input.purchaseIntentId}`;
    expect(await writer.accept(input)).toEqual({ outcome: "HELD", reason: "PAYMENT_UNSETTLED" });
    expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${input.purchaseIntentId}`).toHaveLength(0);
  });
  it("rechecks financial evidence after waiting for a concurrent refund transaction", async () => {
    const input = await acceptanceInput("gid://shopify/Order/8251");
    const worker = postgres(safeUrl(), { max: 1, ssl: false });
    let pending: Promise<unknown> | undefined;
    try {
      await worker`SET ROLE bloombox_worker`;
      const [{ pid }] = await worker`SELECT pg_backend_pid() AS pid`;
      await sql.begin(async (tx) => {
        await tx`SELECT purchase_intent_id FROM bloombox.shopify_payment_evidence WHERE purchase_intent_id = ${input.purchaseIntentId} FOR UPDATE`;
        const writer = new PostgresShopifyOrderAcceptor(worker, protector, acceptancePolicy, () => acceptanceTime);
        pending = writer.accept(input);
        // Wait for the actual lock conflict, not an assumed scheduling delay.
        await vi.waitFor(async () => {
          const rows = await sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
          expect(rows[0].wait_event_type).toBe("Lock");
        }, { timeout: 2000, interval: 10 });
        await tx`UPDATE bloombox.shopify_payment_evidence SET version = 2, status = 'PARTIALLY_REFUNDED', refunded_minor = 500
          WHERE purchase_intent_id = ${input.purchaseIntentId}`;
      });
      expect(await pending).toEqual({ outcome: "HELD", reason: "STALE_PAYMENT" });
      expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${input.purchaseIntentId}`).toHaveLength(0);
    } finally { await pending; await worker.end({ timeout: 5 }); }
  });
  it("rolls back every Order write if its outbox fails, then retries once with worker privileges", async () => {
    const input = await acceptanceInput("gid://shopify/Order/8301"); const worker = postgres(safeUrl(), { max: 1, ssl: false });
    try {
      await worker`SET ROLE bloombox_worker`;
      const writer = new PostgresShopifyOrderAcceptor(worker, protector, acceptancePolicy, () => acceptanceTime);
      await sql`REVOKE INSERT ON bloombox.outbox_events FROM bloombox_worker`;
      try {
        await expect(writer.accept(input)).rejects.toEqual(new ShopifyOrderAcceptancePersistenceError());
        expect(await sql`SELECT id FROM bloombox.orders WHERE purchase_intent_id = ${input.purchaseIntentId}`).toHaveLength(0);
        expect(await sql`SELECT order_id FROM bloombox.shopify_order_acceptances WHERE purchase_intent_id = ${input.purchaseIntentId}`).toHaveLength(0);
      } finally { await sql`GRANT INSERT ON bloombox.outbox_events TO bloombox_worker`; }
      expect(await writer.accept(input)).toMatchObject({ outcome: "CREATED" });
      expect(await writer.accept(input)).toMatchObject({ outcome: "DUPLICATE" });
      expect((await sql`SELECT version, status FROM bloombox.shopify_payment_evidence WHERE purchase_intent_id = ${input.purchaseIntentId}`)[0]).toMatchObject({ version: 1, status: "CAPTURED" });
      expect((await sql`SELECT has_table_privilege('bloombox_worker', 'bloombox.shopify_order_acceptances', 'UPDATE') AS can_update`)[0].can_update).toBe(false);
    } finally { await worker.end({ timeout: 5 }); }
  });
  it("persists financial evidence once across concurrent retries and ignores older paid snapshots", async () => {
    const { intent, link } = await linkedForPayment("gid://shopify/Order/7001");
    const store = new PostgresShopifyPaymentEvidence(sql);
    const initial = await Promise.all(Array.from({ length: 6 }, () => store.record(link, scope, paidSnapshot())));
    expect(initial.filter((result) => result.outcome === "APPLIED")).toHaveLength(1);
    expect(initial.filter((result) => result.outcome === "DUPLICATE")).toHaveLength(5);
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => store.record(link, scope, index % 2 ? refundedSnapshot() : paidSnapshot())));
    expect(results.some((result) => result.outcome === "APPLIED")).toBe(true);
    expect(await store.record(link, scope, paidSnapshot())).toMatchObject({ outcome: "STALE", status: "PARTIALLY_REFUNDED", version: 2 });
    const rows = await sql`SELECT status, captured_minor, refunded_minor, version FROM bloombox.shopify_payment_evidence WHERE purchase_intent_id = ${intent.id}`;
    expect(rows[0]).toMatchObject({ status: "PARTIALLY_REFUNDED", captured_minor: "4000", refunded_minor: "500", version: 2 });
    const events = await sql`SELECT payload FROM bloombox.outbox_events WHERE aggregate_id = ${intent.id} AND event_type = 'payment.shopify_evidence.updated'`;
    const audits = await sql`SELECT safe_metadata FROM bloombox.audit_logs WHERE resource_id = ${intent.id} AND action = 'payment.shopify_evidence.updated'`;
    expect(events).toHaveLength(2); expect(audits).toHaveLength(2);
    expect(JSON.stringify([events, audits])).not.toMatch(/opaque-|secret-key|cartToken|transactions/);
    expect(await sql`SELECT * FROM bloombox.orders WHERE purchase_intent_id = ${intent.id}`).toHaveLength(0);
  });
  it("preserves successful money facts when newer snapshots downgrade or alter a transaction", async () => {
    const { link } = await linkedForPayment("gid://shopify/Order/7002"); const store = new PostgresShopifyPaymentEvidence(sql);
    await store.record(link, scope, refundedSnapshot());
    await expect(store.record(link, scope, { ...paidSnapshot(), updatedAt: "2026-09-11T12:00:00Z" })).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    await expect(store.record(link, scope, { ...refundedSnapshot(600), updatedAt: "2026-09-11T12:00:00Z" })).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    const full: SettlementSnapshot = { ...refundedSnapshot(), updatedAt: "2026-09-11T12:00:00Z", refunded: 4000,
      transactions: [...refundedSnapshot().transactions, { id: "gid://shopify/OrderTransaction/7003", kind: "REFUND", status: "SUCCEEDED", parentId: saleTransaction.id, amount: 3500 }] };
    expect(await store.record(link, scope, full)).toMatchObject({ outcome: "APPLIED", status: "REFUNDED", version: 2 });
    expect(await store.record(link, scope, full)).toMatchObject({ outcome: "DUPLICATE", version: 2 });
  });
  it("requires the exact existing order association and rejects inconsistent provider amounts", async () => {
    const { link } = await linkedForPayment("gid://shopify/Order/7003"); const store = new PostgresShopifyPaymentEvidence(sql);
    for (const candidate of [{ ...link, orderId: "gid://shopify/Order/7999" }, { ...link, purchaseIntentId: randomUUID() }]) {
      await expect(store.record(candidate, scope, paidSnapshot())).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    }
    await expect(store.record(link, "another-shop.myshopify.com", paidSnapshot())).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    await expect(store.record(link, scope, { ...paidSnapshot(), received: 3999 })).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    expect(await sql`SELECT * FROM bloombox.shopify_payment_evidence WHERE purchase_intent_id = ${link.purchaseIntentId}`).toHaveLength(0);
  });
  it("atomically rolls back financial evidence when the worker cannot persist its Outbox", async () => {
    const { link } = await linkedForPayment("gid://shopify/Order/7004"); const worker = postgres(safeUrl(), { max: 1, ssl: false });
    try {
      await worker`SET ROLE bloombox_worker`;
      const store = new PostgresShopifyPaymentEvidence(worker);
      await store.record(link, scope, paidSnapshot());
      await sql`REVOKE INSERT ON bloombox.outbox_events FROM bloombox_worker`;
      try {
        await expect(store.record(link, scope, refundedSnapshot())).rejects.toBeInstanceOf(ShopifyPaymentEvidencePersistenceError);
        expect((await sql`SELECT version, refunded_minor FROM bloombox.shopify_payment_evidence WHERE purchase_intent_id = ${link.purchaseIntentId}`)[0]).toEqual({ version: 1, refunded_minor: "0" });
        expect(await sql`SELECT * FROM bloombox.audit_logs WHERE resource_id = ${link.purchaseIntentId} AND action = 'payment.shopify_evidence.updated'`).toHaveLength(1);
      } finally { await sql`GRANT INSERT ON bloombox.outbox_events TO bloombox_worker`; }
      expect(await store.record(link, scope, refundedSnapshot())).toMatchObject({ status: "PARTIALLY_REFUNDED", version: 2 });
    } finally { await worker.end({ timeout: 5 }); }
  });

  it("creates once across concurrent requests and resumes from a new repository instance", async () => {
    const intent = await prepare();
    const { provider, useCase } = flow(intent);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => useCase.execute(intent.id)));
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(provider.create).toHaveBeenCalledOnce();
    const resumed = flow(intent, new PostgresShopifyCheckoutAttempts(sql, protector));
    await expect(resumed.useCase.execute(intent.id)).resolves.toEqual({ url: cartFor(intent).checkoutUrl, purchaseIntentId: intent.id });
    expect(resumed.provider.create).not.toHaveBeenCalled();
    expect(resumed.provider.retrieve).toHaveBeenCalledWith(cartFor(intent).cartId, expect.any(PurchaseIntent));
    const rows = await sql`SELECT commerce_provider, external_checkout_id, status FROM bloombox.purchase_intents WHERE id = ${intent.id}`;
    expect(rows[0]).toMatchObject({ commerce_provider: "SHOPIFY", external_checkout_id: null, status: "CHECKOUT_CREATED" });
    const secrets = await sql`SELECT credential_ciphertext FROM bloombox.shopify_checkout_attempts WHERE purchase_intent_id = ${intent.id}`;
    expect(secrets[0].credential_ciphertext.toString("utf8")).not.toContain("secret-key");
    const events = await sql`SELECT payload FROM bloombox.outbox_events WHERE aggregate_id = ${intent.id}`;
    const audits = await sql`SELECT safe_metadata FROM bloombox.audit_logs WHERE resource_id = ${intent.id}`;
    expect(events).toHaveLength(3); // ready intent, claim, completed attempt
    expect(audits).toHaveLength(2);
    expect(JSON.stringify([events, audits])).not.toMatch(/secret-key|checkout\.example|テスト宛名|贈る言葉/);
  });

  it("pins Shopify before the first external call and persists success even if intake pauses in flight", async () => {
    const intent = await prepare(); let enabled = true;
    const { provider, useCase } = flow(intent, attempts, () => enabled);
    provider.create.mockImplementation(async () => {
      const rows = await sql`SELECT commerce_provider FROM bloombox.purchase_intents WHERE id = ${intent.id}`;
      expect(rows[0].commerce_provider).toBe("SHOPIFY");
      enabled = false; return cartFor(intent);
    });
    await expect(useCase.execute(intent.id)).resolves.toHaveProperty("url");
    expect((await attempts.claim(intent.id, randomUUID(), scope, now)).attempt.status).toBe("READY");
    await expect(useCase.execute(intent.id)).rejects.toBeInstanceOf(CheckoutPausedError);
  });

  it("never retries creation after an ambiguous provider failure, even after intent expiry", async () => {
    const intent = await prepare(); const { provider, useCase } = flow(intent);
    provider.create.mockRejectedValue(new Error("private-provider-details"));
    await expect(useCase.execute(intent.id)).rejects.toBeInstanceOf(ShopifyCheckoutUncertainError);
    const restarted = flow(intent);
    await expect(restarted.useCase.execute(intent.id)).rejects.toBeInstanceOf(ShopifyCheckoutUncertainError);
    expect(restarted.provider.create).not.toHaveBeenCalled();
    await new PostgresDataRetentionJob(sql).execute(new Date("2026-11-11T00:00:00Z"));
    expect((await intents.findById(intent.id))?.recipient.name).toBe("テスト宛名");
    expect((await attempts.claim(intent.id, randomUUID(), scope, new Date("2026-11-11T00:00:00Z"))).attempt.status).toBe("UNKNOWN");
  });

  it("marks a stale crashed claim unknown and permits only its original late result", async () => {
    const intent = await prepare(); const attemptId = randomUUID();
    await attempts.claim(intent.id, attemptId, scope, now);
    const provider = flow(intent).provider;
    const useCase = new StartShopifyCheckout(intents, attempts, provider, randomUUID,
      () => new Date(now.getTime() + SHOPIFY_STALE_ATTEMPT_MS), () => true);
    await expect(useCase.execute(intent.id)).rejects.toBeInstanceOf(ShopifyCheckoutUncertainError);
    expect(provider.create).not.toHaveBeenCalled();
    await expect(attempts.complete(intent.id, randomUUID(), cartFor(intent), now)).rejects.toBeInstanceOf(ShopifyCheckoutConflictError);
    const later = new Date(now.getTime() + SHOPIFY_STALE_ATTEMPT_MS + 1);
    await attempts.complete(intent.id, attemptId, cartFor(intent), later);
    await attempts.complete(intent.id, attemptId, cartFor(intent), later);
    await attempts.markUnknown(intent.id, attemptId, later);
    expect((await attempts.claim(intent.id, randomUUID(), scope, later)).attempt.status).toBe("READY");
    await expect(attempts.complete(intent.id, attemptId, { ...cartFor(intent), cartId: "gid://shopify/Cart/other?key=secret-key" }, later))
      .rejects.toBeInstanceOf(ShopifyCheckoutConflictError);
  });

  it("keeps a committed cart when its commit acknowledgment is lost", async () => {
    const intent = await prepare();
    const repo: ShopifyCheckoutAttempts = {
      claim: attempts.claim.bind(attempts), markUnknown: attempts.markUnknown.bind(attempts),
      complete: async (...args) => { await attempts.complete(...args); throw new ShopifyCheckoutPersistenceError(); },
    };
    await expect(flow(intent, repo).useCase.execute(intent.id)).rejects.toBeInstanceOf(ShopifyCheckoutUncertainError);
    const restarted = flow(intent);
    await expect(restarted.useCase.execute(intent.id)).resolves.toHaveProperty("url");
    expect(restarted.provider.create).not.toHaveBeenCalled();
  });

  it("does not call the provider when a committed claim acknowledgment is lost", async () => {
    const intent = await prepare();
    const repo: ShopifyCheckoutAttempts = {
      claim: async (...args) => { await attempts.claim(...args); throw new ShopifyCheckoutPersistenceError(); },
      markUnknown: attempts.markUnknown.bind(attempts), complete: attempts.complete.bind(attempts),
    };
    const first = flow(intent, repo);
    await expect(first.useCase.execute(intent.id)).rejects.toBeInstanceOf(ShopifyCheckoutPersistenceError);
    expect(first.provider.create).not.toHaveBeenCalled();
    const restarted = flow(intent);
    await expect(restarted.useCase.execute(intent.id)).rejects.toBeInstanceOf(ShopifyCheckoutUncertainError);
    expect(restarted.provider.create).not.toHaveBeenCalled();
  });

  it("retains the claim if recording uncertainty also fails", async () => {
    const intent = await prepare();
    const repo: ShopifyCheckoutAttempts = {
      claim: attempts.claim.bind(attempts), complete: attempts.complete.bind(attempts),
      markUnknown: async () => { throw new ShopifyCheckoutPersistenceError(); },
    };
    const first = flow(intent, repo); first.provider.create.mockRejectedValue(new Error("offline"));
    await expect(first.useCase.execute(intent.id)).rejects.toBeInstanceOf(ShopifyCheckoutPersistenceError);
    const restarted = flow(intent);
    await expect(restarted.useCase.execute(intent.id)).rejects.toBeInstanceOf(ShopifyCheckoutUncertainError);
    expect(restarted.provider.create).not.toHaveBeenCalled();
  });

  it("does not create a replacement when a known cart cannot be retrieved", async () => {
    const intent = await prepare(); const first = flow(intent); await first.useCase.execute(intent.id);
    const resumed = flow(intent); resumed.provider.retrieve.mockRejectedValue(new Error("Unavailable"));
    await expect(resumed.useCase.execute(intent.id)).rejects.toThrow("Unavailable");
    expect(resumed.provider.create).not.toHaveBeenCalled();
    await expect(attempts.claim(intent.id, randomUUID(), "another-shop.myshopify.com", now)).rejects.toBeInstanceOf(ShopifyCheckoutConflictError);
  });

  it("rejects cross-intent ciphertext substitution and wrong keys", async () => {
    const first = await prepare(); const second = await prepare();
    await flow(first).useCase.execute(first.id); await flow(second).useCase.execute(second.id);
    await sql`UPDATE bloombox.shopify_checkout_attempts SET credential_ciphertext =
      (SELECT credential_ciphertext FROM bloombox.shopify_checkout_attempts WHERE purchase_intent_id = ${first.id})
      WHERE purchase_intent_id = ${second.id}`;
    await expect(attempts.claim(second.id, randomUUID(), scope, now)).rejects.toBeInstanceOf(ShopifyCheckoutPersistenceError);
    const wrongKeys = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 22)]]) });
    await expect(new PostgresShopifyCheckoutAttempts(sql, wrongKeys).claim(first.id, randomUUID(), scope, now))
      .rejects.toBeInstanceOf(ShopifyCheckoutPersistenceError);
  });

  it("rolls credentials, intent transition and events back if the completion transaction fails", async () => {
    const intent = await prepare(); const attemptId = randomUUID(); await attempts.claim(intent.id, attemptId, scope, now);
    await sql.unsafe(`CREATE FUNCTION bloombox.test_completion_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type = 'checkout.shopify_attempt.ready' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_completion_failure BEFORE INSERT ON bloombox.outbox_events FOR EACH ROW EXECUTE FUNCTION bloombox.test_completion_failure();`);
    try {
      await expect(attempts.complete(intent.id, attemptId, cartFor(intent), now)).rejects.toBeInstanceOf(ShopifyCheckoutPersistenceError);
      expect((await attempts.claim(intent.id, randomUUID(), scope, now)).attempt.status).toBe("CREATING");
      expect((await intents.findById(intent.id))?.status).toBe("READY_FOR_CHECKOUT");
    } finally { await sql.unsafe("DROP TRIGGER test_completion_failure ON bloombox.outbox_events; DROP FUNCTION bloombox.test_completion_failure()"); }
  });

  it("prevents a concurrent Stripe and Shopify start from calling both providers", async () => {
    const intent = await prepare(); const shopify = flow(intent);
    const session = { provider: "STRIPE" as const, id: "cs_test_race", url: "https://checkout.stripe.com/test", purchaseIntentId: intent.id,
      apiVersion: "test", expiresAt: intent.expiresAt };
    const stripeProvider = { provider: "STRIPE" as const, create: vi.fn(async () => session), retrieve: vi.fn(async () => session) };
    const stripe = new StartCheckout(intents, stripeProvider, () => now);
    const results = await Promise.allSettled([shopify.useCase.execute(intent.id), stripe.execute(intent.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(shopify.provider.create.mock.calls.length + stripeProvider.create.mock.calls.length).toBe(1);
    const stored = await intents.findById(intent.id);
    await expect(intents.claimCommerceProvider(intent.id, stored?.commerceProvider === "STRIPE" ? "SHOPIFY" : "STRIPE")).rejects.toThrow();
  });

  it("refuses expired unstarted intents, plaintext cart IDs and provider switches at the database boundary", async () => {
    const intent = await prepare();
    await expect(attempts.claim(intent.id, randomUUID(), scope, new Date("2026-09-13T00:00:00Z"))).rejects.toBeInstanceOf(ShopifyCheckoutConflictError);
    expect((await intents.findById(intent.id))?.commerceProvider).toBeUndefined();
    await attempts.claim(intent.id, randomUUID(), scope, now);
    await expect(sql`UPDATE bloombox.purchase_intents SET commerce_provider = 'STRIPE' WHERE id = ${intent.id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE bloombox.purchase_intents SET external_checkout_id = 'gid://shopify/Cart/test?key=secret-key' WHERE id = ${intent.id}`)
      .rejects.toMatchObject({ code: "23514" });
  });

  it("holds the claim without calling Shopify if intake pauses immediately after claim", async () => {
    const intent = await prepare(); let enabled = true;
    const repo: ShopifyCheckoutAttempts = {
      claim: async (...args) => { const result = await attempts.claim(...args); enabled = false; return result; },
      markUnknown: attempts.markUnknown.bind(attempts), complete: attempts.complete.bind(attempts),
    };
    const current = flow(intent, repo, () => enabled);
    await expect(current.useCase.execute(intent.id)).rejects.toBeInstanceOf(ShopifyCheckoutUncertainError);
    expect(current.provider.create).not.toHaveBeenCalled();
    expect((await attempts.claim(intent.id, randomUUID(), scope, now)).attempt.status).toBe("UNKNOWN");
  });

  it("rejects mismatched create and retrieve results without a replacement attempt", async () => {
    const intent = await prepare(); const first = flow(intent);
    first.provider.create.mockResolvedValue({ ...cartFor(intent), purchaseIntentId: purchaseIntentId(randomUUID()) });
    await expect(first.useCase.execute(intent.id)).rejects.toBeInstanceOf(ShopifyCheckoutUncertainError);
    expect((await attempts.claim(intent.id, randomUUID(), scope, now)).attempt.status).toBe("UNKNOWN");
    const second = await prepare(); await flow(second).useCase.execute(second.id);
    const resumed = flow(second);
    resumed.provider.retrieve.mockResolvedValue({ ...cartFor(second), apiVersion: "2026-10" });
    await expect(resumed.useCase.execute(second.id)).rejects.toBeInstanceOf(ShopifyCheckoutConflictError);
    expect(resumed.provider.create).not.toHaveBeenCalled();
  });

  it("has no workflow exposure by default and grants only intended database capabilities", async () => {
    const intent = await prepare(); const provider = flow(intent).provider;
    await expect(new StartShopifyCheckout(intents, attempts, provider, randomUUID).execute(intent.id)).rejects.toBeInstanceOf(CheckoutPausedError);
    expect(provider.create).not.toHaveBeenCalled();
    const rows = await sql`SELECT
      has_table_privilege('bloombox_application', 'bloombox.shopify_checkout_attempts', 'INSERT') AS app_insert,
      has_table_privilege('bloombox_worker', 'bloombox.shopify_checkout_attempts', 'SELECT') AS worker_read,
      has_table_privilege('bloombox_worker', 'bloombox.shopify_checkout_attempts', 'UPDATE') AS worker_write,
      has_table_privilege('bloombox_readonly', 'bloombox.shopify_checkout_attempts', 'UPDATE') AS readonly_write`;
    expect(rows[0]).toEqual({ app_insert: true, worker_read: true, worker_write: false, readonly_write: false });
  });
});

function makeIntent() {
  const id = purchaseIntentId(randomUUID());
  const intent = PurchaseIntent.create({ id, displayId: `BBI-${id}`, createdAt: now,
    item: { productId: catalogProductReference("shopify_test"), externalProductReference: commerceProductReference("gid://shopify/ProductVariant/101"),
      productName: "Test flower", quantity: 1, unitPriceSnapshot: money(4000), subtotal: money(4000) },
    recipient: { name: recipientName("テスト宛名"), deliveryDate: "2026-09-14" }, giftMessage: giftMessage("贈る言葉"),
  });
  intent.transitionTo("READY_FOR_CHECKOUT"); return intent;
}
function cartFor(intent: PurchaseIntent) {
  return { cartId: `gid://shopify/Cart/opaque-${intent.id}?key=secret-key`, checkoutUrl: "https://checkout.example.test/private",
    purchaseIntentId: intent.id, apiVersion: "2026-07" };
}
