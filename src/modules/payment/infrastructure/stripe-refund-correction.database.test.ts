import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PostgresCustomerIdentityRepository } from "@/modules/customer/infrastructure/postgres-customer-identity-repository";
import { PostgresCustomerPurchasePerformance } from "@/modules/order/infrastructure/postgres-customer-purchase-performance";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import type { VerifiedProviderEvent } from "../application/receive-provider-webhook";
import { StripeCommerceEventProcessor } from "./stripe-commerce-event-processor";
import { readLocalFinance } from "./finance-reconciliation-reader";

const url = process.env.TEST_DATABASE_URL;
if (url && (!["127.0.0.1", "localhost"].includes(new URL(url).hostname) || !new URL(url).pathname.includes("test"))) throw new Error("Isolated local test database required");
(url ? describe : describe.skip)("verified Stripe refund failure correction", () => {
  const sql = postgres(url ?? "postgres://invalid/test", { ssl: false, max: 4 });
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 9)]]) });
  const processor = new StripeCommerceEventProcessor(sql, protector, "inclusive", () => ({ create: async () => { throw new Error("Refund must not create buyers"); } }));
  const performance = new PostgresCustomerPurchasePerformance(sql);
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], { env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_MODE: "disable" }, stdio: "pipe" });
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });
  async function fixture() {
    const customer = await new PostgresCustomerIdentityRepository(sql).registerGoogleSubject(randomUUID());
    const buyer = randomUUID(), order = randomUUID(), payment = randomUUID(), capture = randomUUID();
    await sql`INSERT INTO bloombox.buyers(id,customer_id) VALUES(${buyer},${customer.customerId})`;
    await sql`INSERT INTO bloombox.orders(id,display_id,buyer_id,status,commerce_provider,external_order_id,currency,subtotal_minor,tax_minor,shipping_minor,discount_minor,total_minor,created_at,updated_at)
      VALUES(${order},${order},${buyer},'CONFIRMED','STRIPE',${order},'JPY',4000,0,1000,0,5000,now(),now())`;
    await sql`INSERT INTO bloombox.payments(id,order_id,commerce_provider,external_payment_id,status,amount_requested_minor,amount_authorized_minor,amount_captured_minor,amount_refunded_minor,currency,created_at,updated_at)
      VALUES(${payment},${order},'STRIPE',${'pi_' + payment},'CAPTURED',5000,5000,5000,0,'JPY',now(),now())`;
    await sql`INSERT INTO bloombox.fulfillments(id,order_id,status,created_at,updated_at) VALUES(${randomUUID()},${order},'CANCELLED',now(),now())`;
    await sql.begin(async (tx) => {
      await tx`INSERT INTO bloombox.financial_transactions(id,order_id,payment_id,transaction_type,currency,external_reference,occurred_at)
        VALUES(${capture},${order},${payment},'CAPTURE','JPY',${'pi_' + payment},now())`;
      await tx`INSERT INTO bloombox.ledger_entries(id,financial_transaction_id,account_code,signed_amount_minor,currency)
        VALUES(${randomUUID()},${capture},'STRIPE_CLEARING',5000,'JPY'),(${randomUUID()},${capture},'ORDER_REVENUE',-5000,'JPY')`;
    });
    function event(amount = 1000, status = "succeeded", at = "2026-09-17T01:00:00Z", refundId = 're_' + payment): VerifiedProviderEvent {
      return { provider: "STRIPE", providerAccountId: "acct_fixture", externalEventId: 'evt_' + randomUUID(), eventType: status === "failed" ? "refund.failed" : "refund.updated", externalObjectId: refundId,
        apiVersion: "2026-07-29.dahlia", occurredAt: new Date(at), payload: { objectType: "refund", id: refundId, paymentIntentId: 'pi_' + payment, amount, currency: "jpy", status, reason: "requested_by_customer", failureReason: status === "failed" ? "declined" : null } };
    }
    return { customer: customer.customerId, order, payment, event };
  }
  async function financial(payment: string) { return (await readLocalFinance(sql)).payments.find((row) => row.id === payment); }
  async function reversalCount(payment: string) {
    return (await sql`SELECT count(*)::int AS count FROM bloombox.financial_transactions WHERE payment_id=${payment} AND transaction_type='REFUND_REVERSAL'`)[0].count;
  }
  it.each([1000, 5000])("reverses %i only once, restores customer performance and leaves cancellation unchanged", async (amount) => {
    const f = await fixture();
    await processor.process(f.event(amount));
    expect(await performance.readEligibleSpend(f.customer)).toBe(Math.max(0, 4000 - amount));
    const failure = f.event(amount, "failed", "2026-09-17T02:00:00Z");
    await Promise.all([processor.process(failure), processor.process(failure), processor.process({ ...failure, externalEventId: 'evt_' + randomUUID() })]);
    expect(await financial(f.payment)).toMatchObject({ captured: 5000, refunded: 0, ledgerRefunded: 0, ledgerCaptured: 5000, ledgerImbalanced: false });
    expect(await reversalCount(f.payment)).toBe(1);
    expect(await performance.readEligibleSpend(f.customer)).toBe(4000);
    expect((await sql`SELECT status FROM bloombox.orders WHERE id=${f.order}`)[0].status).toBe("CONFIRMED");
    expect((await sql`SELECT status FROM bloombox.fulfillments WHERE order_id=${f.order}`)[0].status).toBe("CANCELLED");
    expect((await sql`SELECT count(*)::int AS count FROM bloombox.audit_logs WHERE resource_id=${f.payment} AND action='payment.refund_reversed'`)[0].count).toBe(1);
  });
  it("preserves another successful refund and rejects old success resurrection", async () => {
    const f = await fixture();
    await processor.process(f.event(1000));
    await processor.process(f.event(1500, "succeeded", "2026-09-17T01:30:00Z", 're_other_' + f.payment));
    await processor.process(f.event(1000, "failed", "2026-09-17T02:00:00Z"));
    await processor.process(f.event(1000));
    await processor.process(f.event(1000, "pending", "2026-09-17T00:00:00Z"));
    expect(await financial(f.payment)).toMatchObject({ refunded: 1500, ledgerRefunded: 1500 });
    expect(await performance.readEligibleSpend(f.customer)).toBe(2500);
    await expect(processor.process(f.event(1000, "succeeded", "2026-09-17T03:00:00Z"))).rejects.toThrow("Refund provider state is inconsistent");
    expect(await reversalCount(f.payment)).toBe(1);
  });
  it("preserves open disputes when refund failure restores captured funds", async () => {
    const f = await fixture();
    await processor.process(f.event());
    await sql`INSERT INTO bloombox.disputes(id,payment_id,commerce_provider,external_dispute_id,status,amount_minor,currency,created_at,updated_at)
      VALUES(${randomUUID()},${f.payment},'STRIPE',${'dp_' + f.payment},'NEEDS_RESPONSE',5000,'JPY',now(),now())`;
    await sql`UPDATE bloombox.payments SET status='DISPUTED' WHERE id=${f.payment}`;
    await processor.process(f.event(1000, "failed", "2026-09-17T02:00:00Z"));
    expect((await sql`SELECT status FROM bloombox.payments WHERE id=${f.payment}`)[0].status).toBe("DISPUTED");
    expect(await performance.readEligibleSpend(f.customer)).toBe(0);
    expect(await financial(f.payment)).toMatchObject({ refunded: 0, ledgerRefunded: 0 });
  });
  it.each([true, false])("converges when success and failure share one second (success first: %s)", async (successFirst) => {
    const f = await fixture();
    const success = f.event(), failure = f.event(1000, "failed");
    for (const event of successFirst ? [success, failure] : [failure, success]) await processor.process(event);
    expect(await financial(f.payment)).toMatchObject({ refunded: 0, ledgerRefunded: 0 });
    expect(await reversalCount(f.payment)).toBe(successFirst ? 1 : 0);
    expect((await sql`SELECT status FROM bloombox.refunds WHERE payment_id=${f.payment}`)[0].status).toBe("FAILED");
  });
  it("rejects altered amount, currency, identity and inconsistent failure payload without mutation", async () => {
    const f = await fixture();
    await processor.process(f.event());
    const failure = f.event(1000, "failed", "2026-09-17T02:00:00Z");
    for (const event of [
      { ...failure, payload: { ...failure.payload, amount: 2000 } },
      { ...failure, payload: { ...failure.payload, currency: "usd" } },
      { ...failure, externalObjectId: "re_other" },
      { ...failure, payload: { ...failure.payload, status: "succeeded" } },
    ]) await expect(processor.process(event)).rejects.toThrow();
    expect(await financial(f.payment)).toMatchObject({ refunded: 1000, ledgerRefunded: 1000 });
    expect(await reversalCount(f.payment)).toBe(0);
  });
  it("rolls back refund, payment, ledger and audit together when reversal writing fails, then retries", async () => {
    const f = await fixture();
    await processor.process(f.event());
    const failure = f.event(1000, "failed", "2026-09-17T02:00:00Z");
    await sql.unsafe(`CREATE FUNCTION bloombox.test_reject_refund_reversal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.transaction_type = 'REFUND_REVERSAL' THEN RAISE EXCEPTION 'injected write failure'; END IF; RETURN NEW; END $$`);
    await sql.unsafe(`CREATE TRIGGER test_reject_refund_reversal BEFORE INSERT ON bloombox.financial_transactions FOR EACH ROW EXECUTE FUNCTION bloombox.test_reject_refund_reversal()`);
    try { await expect(processor.process(failure)).rejects.toThrow("injected write failure"); }
    finally { await sql.unsafe("DROP TRIGGER test_reject_refund_reversal ON bloombox.financial_transactions; DROP FUNCTION bloombox.test_reject_refund_reversal()"); }
    expect(await financial(f.payment)).toMatchObject({ refunded: 1000, ledgerRefunded: 1000 });
    expect((await sql`SELECT status FROM bloombox.refunds WHERE payment_id=${f.payment}`)[0].status).toBe("SUCCEEDED");
    expect((await sql`SELECT count(*)::int AS count FROM bloombox.audit_logs WHERE resource_id=${f.payment} AND action='payment.refund_reversed'`)[0].count).toBe(0);
    await processor.process(failure);
    expect(await reversalCount(f.payment)).toBe(1);
  });
});
