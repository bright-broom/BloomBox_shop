import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { purchaseIntentId } from "@/modules/checkout/domain/purchase-intent";
import { CreatePurchaseIntent } from "@/modules/checkout/application/create-purchase-intent";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import { PostgresPurchaseIntentRepository } from "@/modules/checkout/infrastructure/postgres-purchase-intent-repository";
import { PostgresOrderStatusQuery } from "@/modules/order/infrastructure/postgres-order-status-query";
import { GetOrderStatus } from "@/modules/order/public";
import { ReceiveProviderWebhook } from "@/modules/payment/application/receive-provider-webhook";
import { PostgresWebhookInbox } from "@/modules/payment/infrastructure/postgres-webhook-inbox";
import { StripeWebhookVerifier } from "@/modules/payment/infrastructure/stripe-webhook-verifier";
import { LookupPostalCode } from "@/modules/fulfillment/application/lookup-postal-code";
import { ZipcloudPostalAddressRepository } from "@/modules/fulfillment/infrastructure/zipcloud-postal-address-repository";
import { AesGcmDataProtector } from "../security/aes-gcm-data-protector";
import { loadDatabaseConfig } from "../config/database-config";
import { loadStripeConfig } from "../config/stripe-config";
import { createPostgresClient } from "./postgres-client";

const { webhookExecute, postalExecute } = vi.hoisted(() => ({ webhookExecute: vi.fn(), postalExecute: vi.fn() }));
vi.mock("@/shared/infrastructure/composition-root", () => ({
  getStripeWebhookReceiver: () => ({ execute: webhookExecute }),
  application: { lookupPostalCode: { execute: postalExecute } },
}));
import { POST as webhookPost } from "@/app/api/webhooks/stripe/route";
import { POST as postalPost } from "@/app/api/postal-code/route";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Only isolated local test databases are allowed");
}
const sql = createPostgresClient(loadDatabaseConfig({
  DATABASE_URL: databaseUrl ?? "postgres://invalid/test_missing", DATABASE_SSL_MODE: "disable",
  DATABASE_MAX_CONNECTIONS: "2", DATABASE_CONNECTION_TIMEOUTS_ENABLED: "true",
}));
const protector = new AesGcmDataProtector({ activeKeyId: "load-test", keys: new Map([["load-test", Buffer.alloc(32, 39)]]) });
const intents = new PostgresPurchaseIntentRepository(sql, protector);
const now = new Date("2026-09-17T00:00:00Z");
const ids = Array.from({ length: 60 }, () => randomUUID());
const stripe = loadStripeConfig({
  STRIPE_MODE: "test", STRIPE_CHECKOUT_SECRET_KEY: "rk_test_load_checkout_only",
  STRIPE_RECONCILIATION_SECRET_KEY: "rk_test_load_reconcile_only", STRIPE_WEBHOOK_SECRET: "whsec_synthetic_load_only",
  STRIPE_ACCOUNT_ID: "acct_load_synthetic", STRIPE_SHIPPING_RATE_ID: "shr_load_synthetic",
  STRIPE_TAX_BEHAVIOR: "inclusive", STRIPE_AUTOMATIC_TAX_ENABLED: "true", STRIPE_TERMS_ACCEPTANCE: "required",
  BLOOMBOX_PUBLIC_ORIGIN: "http://localhost:3041",
});

(databaseUrl ? describe : describe.skip)("bounded synthetic commerce load (no external calls)", () => {
  beforeAll(() => {
    execFileSync(process.execPath, ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    const receiver = new ReceiveProviderWebhook(new StripeWebhookVerifier(stripe), new PostgresWebhookInbox(sql, protector));
    webhookExecute.mockImplementation((body: string, signature: string) => receiver.execute(body, signature));
    const postal = new LookupPostalCode(new ZipcloudPostalAddressRepository(async () => ({
      ok: true, json: async () => ({ status: 200, message: null, results: [
        { address1: "東京都", address2: "千代田区", address3: "千代田", zipcode: "1000001" },
      ] }),
    })));
    postalExecute.mockImplementation((code: string) => postal.execute(code));
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });

  it("keeps purchases, references and signed webhook duplicates correct under concurrent contention", async () => {
    const create = new CreatePurchaseIntent(new InMemoryProductRepository(), intents, () => now);
    const reports = [];
    // The product fixture isolates persistence/concurrency; this is not native inventory or Stripe Checkout E2E.
    reports.push(await measure("purchase_start", 120, 12, async (index) => {
      const id = ids[Math.floor(index / 2)];
      const intent = await create.execute({ requestId: id, productId: "prod_bloombox_m", quantity: 1,
        recipientName: "負荷試験", giftMessage: "いつもありがとう", deliveryDate: "2026-09-21" });
      expect(intent.id).toBe(id);
      expect(intent.item.subtotal.amount).toBe(4000);
      expect(intent.shippingAmount?.amount).toBe(1000);
    }));
    const [counts] = await sql`SELECT count(*)::int AS count FROM bloombox.purchase_intents WHERE id = ANY(${ids}::uuid[])`;
    expect(counts.count).toBe(60);
    const outbox = await sql`SELECT aggregate_id, count(*)::int AS count FROM bloombox.outbox_events WHERE aggregate_id = ANY(${ids}::uuid[]) GROUP BY aggregate_id`;
    expect(outbox).toHaveLength(60);
    expect(outbox.every((row) => row.count === 1)).toBe(true);
    for (const id of ids) {
      const intent = await intents.findById(purchaseIntentId(id));
      if (!intent) throw new Error("Missing test intent");
      intent.recordCheckoutCreated({ provider: "STRIPE", externalCheckoutId: checkoutId(id), providerApiVersion: stripe.apiVersion, occurredAt: now });
      await intents.saveCheckoutCreated(intent);
    }
    const getStatus = new GetOrderStatus(new PostgresOrderStatusQuery(sql));
    reports.push(await measure("order_reference", 120, 12, async (index) => {
      const id = ids[index % ids.length];
      expect(await getStatus.execute(checkoutId(id))).toMatchObject({ purchaseIntentId: id, progress: "PROCESSING", orderCreated: false });
    }));
    const received: boolean[] = [];
    reports.push(await measure("signed_webhook", 120, 12, async (index) => {
      const id = ids[Math.floor(index / 2)];
      const raw = JSON.stringify({ id: `evt_${id.replaceAll("-", "")}`, type: "checkout.session.expired", api_version: stripe.apiVersion,
        livemode: false, created: Math.floor(now.getTime() / 1000), data: { object: {
          id: checkoutId(id), client_reference_id: id, payment_intent: null, payment_status: "unpaid", status: "expired",
          amount_total: null, amount_subtotal: null, currency: "jpy", total_details: null,
          customer: null, customer_details: null, collected_information: null, metadata: {},
        } },
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", stripe.webhookSecret).update(`${timestamp}.${raw}`).digest("hex");
      const response = await webhookPost(new Request("https://example.test/api/webhooks/stripe", {
        method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body: raw,
      }));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.received).toBe(true);
      received.push(result.duplicate);
    }));
    expect(received.filter(Boolean)).toHaveLength(60);
    expect(await sql`SELECT id FROM bloombox.webhook_inbox WHERE external_event_id = ANY(${ids.map((id) => `evt_${id.replaceAll("-", "")}`)})`).toHaveLength(60);
    reports.push(await measure("postal_lookup_fixture", 120, 12, async () => {
      const response = await postalPost(new Request("https://example.test/api/postal-code", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ postalCode: "100-0001" }),
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, addresses: [{ prefecture: "東京都" }] });
    }));
    const backends = new Set<number>();
    reports.push(await measure("pool_saturation", 60, 12, async () => {
      const [row] = await sql`SELECT pg_backend_pid() AS pid, pg_sleep(0.002)`;
      backends.add(row.pid);
    }));
    expect(backends.size).toBeLessThanOrEqual(2);
    console.info(JSON.stringify({ kind: "synthetic-local-baseline", requests: 540, poolMaximum: 2, actualBackends: backends.size, reports }));
  });
});

function checkoutId(id: string): string { return `cs_test_${id.replaceAll("-", "")}`; }

async function measure(name: string, requests: number, concurrency: number, run: (index: number) => Promise<void>) {
  const samples: number[] = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = next++;
      if (index >= requests) return;
      const start = performance.now();
      await run(index);
      samples.push(performance.now() - start);
    }
  }));
  const elapsed = performance.now() - started;
  samples.sort((a, b) => a - b);
  const percentile = (fraction: number) => Math.round(samples[Math.ceil(samples.length * fraction) - 1] * 100) / 100;
  return { name, requests, concurrency, elapsedMs: Math.round(elapsed), requestsPerSecond: Math.round(requests / elapsed * 1000), p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99) };
}
