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
