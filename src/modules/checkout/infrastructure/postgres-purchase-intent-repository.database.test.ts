import { PostgresCheckoutBuyerWriter } from "@/modules/customer/infrastructure/postgres-checkout-buyer-writer";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { money } from "@/shared/domain/money";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { PostgresDataRetentionJob } from "@/shared/infrastructure/database/data-retention-job";
import { PostgresWebhookInbox } from "@/modules/payment/infrastructure/postgres-webhook-inbox";
import { ProcessProviderInbox } from "@/modules/payment/application/process-provider-inbox";
import { StripeCommerceEventProcessor } from "@/modules/payment/infrastructure/stripe-commerce-event-processor";
import { StripeEventReconciler } from "@/modules/payment/infrastructure/stripe-event-reconciler";
import { StripeWebhookVerifier } from "@/modules/payment/infrastructure/stripe-webhook-verifier";
import { PostgresOrderStatusQuery } from "@/modules/order/infrastructure/postgres-order-status-query";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";
import {
  catalogProductReference,
  commerceProductReference,
  PurchaseIntent,
  purchaseIntentId,
} from "../domain/purchase-intent";
import { giftMessage, recipientName } from "../domain/purchase-intent-policy";
import {
  PurchaseIntentAlreadyExistsError,
} from "../domain/purchase-intent-repository";
import { PostgresPurchaseIntentRepository } from "./postgres-purchase-intent-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("PostgreSQL commerce foundation", () => {
  const sql = postgres(assertSafeTestDatabaseUrl(databaseUrl), { max: 2, ssl: false });
  const protector = new AesGcmDataProtector({
    activeKeyId: "integration-key",
    keys: new Map([["integration-key", Buffer.alloc(32, 11)]]),
  });

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    runMigrations();
    runMigrations();
    const rolePolicy = (await readFile("database/roles.sql", "utf8"))
      .replace(/^\\set ON_ERROR_STOP on$/m, "");
    await sql.unsafe(rolePolicy);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("applies each checksummed migration once", async () => {
    const rows = await sql`
      SELECT version, checksum
      FROM bloombox.schema_migrations
      ORDER BY version
    `;

    expect(rows).toHaveLength(24);
    expect(rows.map((row) => row.version)).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024"]);
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.checksum))).toBe(true);
  });

  it("atomically persists an encrypted purchase intent and its outbox event", async () => {
    const intentId = purchaseIntentId(randomUUID());
    const intent = PurchaseIntent.create({
      id: intentId,
      displayId: `BBI-20260821-${intentId.slice(0, 4).toUpperCase()}`,
      item: {
        productId: catalogProductReference("prod_haru_01"),
        externalProductReference: commerceProductReference("gid://shopify/ProductVariant/101"),
        productName: "春のひかり",
        quantity: 1,
        unitPriceSnapshot: money(6600),
        subtotal: money(6600),
      },
      recipient: {
        name: recipientName("山田 花子"),
        deliveryDate: "2026-08-28",
      },
      giftMessage: giftMessage("おめでとう"),
      createdAt: new Date("2026-08-21T00:00:00.000Z"),
    });
    intent.transitionTo("READY_FOR_CHECKOUT");
    const repository = new PostgresPurchaseIntentRepository(sql, protector);

    await repository.save(intent);
    const restored = await repository.findById(intentId);
    const rawRows = await sql`
      SELECT
        intent.recipient_ciphertext,
        intent.gift_message_ciphertext,
        item.catalog_product_id,
        item.external_product_id
      FROM bloombox.purchase_intents AS intent
      JOIN bloombox.purchase_intent_items AS item ON item.purchase_intent_id = intent.id
      WHERE intent.id = ${intentId}
    `;
    const outboxRows = await sql`
      SELECT event_type, payload
      FROM bloombox.outbox_events
      WHERE aggregate_id = ${intentId}
    `;

    expect(restored?.status).toBe("READY_FOR_CHECKOUT");
    expect(restored?.recipient.name).toBe("山田 花子");
    expect(restored?.giftMessage).toBe("おめでとう");
    expect(Buffer.concat([
      rawRows[0].recipient_ciphertext,
      rawRows[0].gift_message_ciphertext,
    ]).toString("utf8")).not.toContain("花子");
    expect(rawRows[0]).toMatchObject({
      catalog_product_id: "prod_haru_01",
      external_product_id: "gid://shopify/ProductVariant/101",
    });
    expect(outboxRows).toEqual([{
      event_type: "checkout.purchase_intent.ready",
      payload: { purchaseIntentId: intentId, status: "READY_FOR_CHECKOUT" },
    }]);

    await expect(repository.save(intent)).rejects.toBeInstanceOf(PurchaseIntentAlreadyExistsError);
    const counts = await sql`
      SELECT
        (SELECT COUNT(*)::integer FROM bloombox.purchase_intents WHERE id = ${intentId}) AS intents,
        (SELECT COUNT(*)::integer FROM bloombox.outbox_events WHERE aggregate_id = ${intentId}) AS events
    `;
    expect(counts[0]).toEqual({ intents: 1, events: 1 });
  });

  it("enforces balanced append-only financial entries at commit", async () => {
    const transactionId = randomUUID();
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO bloombox.financial_transactions (
          id, transaction_type, currency, occurred_at
        ) VALUES (${transactionId}, 'CAPTURE', 'JPY', clock_timestamp())
      `;
      await transaction`
        INSERT INTO bloombox.ledger_entries (
          id, financial_transaction_id, account_code, signed_amount_minor, currency
        ) VALUES
          (${randomUUID()}, ${transactionId}, 'CASH', 6600, 'JPY'),
          (${randomUUID()}, ${transactionId}, 'CUSTOMER_RECEIVABLE', -6600, 'JPY')
      `;
    });

    const invalidTransactionId = randomUUID();
    await expect(sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO bloombox.financial_transactions (
          id, transaction_type, currency, occurred_at
        ) VALUES (${invalidTransactionId}, 'CAPTURE', 'JPY', clock_timestamp())
      `;
      await transaction`
        INSERT INTO bloombox.ledger_entries (
          id, financial_transaction_id, account_code, signed_amount_minor, currency
        ) VALUES
          (${randomUUID()}, ${invalidTransactionId}, 'CASH', 6600, 'JPY'),
          (${randomUUID()}, ${invalidTransactionId}, 'CUSTOMER_RECEIVABLE', -6500, 'JPY')
      `;
    })).rejects.toMatchObject({ code: "23514" });
  });

  it("converts a paid Stripe checkout into one order, payment, fulfillment, and ledger", async () => {
    const intentId = purchaseIntentId(randomUUID());
    const checkoutId = `cs_test_${intentId.replaceAll("-", "")}`;
    const paymentIntentId = `pi_${intentId.replaceAll("-", "")}`;
    const intent = PurchaseIntent.create({
      id: intentId,
      displayId: `BBI-20260821-${intentId.slice(0, 4).toUpperCase()}`,
      item: {
        productId: catalogProductReference("prod_haru_01"),
        externalProductReference: commerceProductReference("gid://shopify/ProductVariant/101"),
        productName: "春のひかり",
        quantity: 1,
        unitPriceSnapshot: money(6600),
        subtotal: money(6600),
      },
      recipient: { name: recipientName("山田 花子"), deliveryDate: "2026-08-28" },
      giftMessage: giftMessage("おめでとう"),
      createdAt: new Date("2026-08-21T00:00:00.000Z"),
    });
    intent.transitionTo("READY_FOR_CHECKOUT");
    const repository = new PostgresPurchaseIntentRepository(sql, protector);
    await repository.save(intent);
    intent.recordCheckoutCreated({
      provider: "STRIPE",
      externalCheckoutId: checkoutId,
      providerApiVersion: "2026-07-29.dahlia",
      occurredAt: new Date("2026-08-21T00:05:00.000Z"),
    });
    await repository.saveCheckoutCreated(intent);
    const processor = new StripeCommerceEventProcessor(sql, protector, "inclusive", (tx) => new PostgresCheckoutBuyerWriter(tx));
    const paidEvent = {
      provider: "STRIPE" as const,
      providerAccountId: "acct_example",
      externalEventId: `evt_paid_${intentId}`,
      eventType: "checkout.session.completed",
      externalObjectId: checkoutId,
      apiVersion: "2026-07-29.dahlia",
      occurredAt: new Date("2026-08-21T00:10:00.000Z"),
      payload: {
        objectType: "checkout_session",
        id: checkoutId,
        purchaseIntentId: intentId,
        paymentIntentId,
        paymentStatus: "paid",
        checkoutStatus: "complete",
        amountTotal: 7100,
        amountSubtotal: 6600,
        currency: "jpy",
        totalDetails: { amount_discount: 0, amount_shipping: 500, amount_tax: 600 },
        customerId: "cus_test_buyer",
        customerDetails: { email: "buyer@example.test" },
        collectedInformation: {
          shipping_details: { name: "山田 花子", address: { country: "JP" } },
        },
      },
    };

    await processor.process(paidEvent);
    await processor.process(paidEvent);
    const rows = await sql`
      SELECT
        intent.status AS intent_status,
        orders.status AS order_status,
        orders.total_minor,
        orders.included_tax_minor,
        payments.status AS payment_status,
        fulfillments.status AS fulfillment_status,
        order_item.catalog_product_id,
        order_item.external_product_id,
        order_item.included_tax_minor AS item_included_tax_minor,
        gift.address_ciphertext,
        (SELECT COUNT(*)::integer FROM bloombox.orders WHERE purchase_intent_id = ${intentId}) AS order_count,
        (SELECT COUNT(*)::integer FROM bloombox.financial_transactions WHERE payment_id = payments.id) AS ledger_transaction_count
      FROM bloombox.purchase_intents AS intent
      JOIN bloombox.orders ON orders.purchase_intent_id = intent.id
      JOIN bloombox.payments ON payments.order_id = orders.id
      JOIN bloombox.fulfillments ON fulfillments.order_id = orders.id
      JOIN bloombox.order_items AS order_item ON order_item.order_id = orders.id
      JOIN bloombox.order_gift_snapshots AS gift ON gift.order_id = orders.id
      WHERE intent.id = ${intentId}
    `;

    expect(rows[0]).toMatchObject({
      intent_status: "CONVERTED",
      order_status: "CONFIRMED",
      total_minor: "7100",
      included_tax_minor: "600",
      item_included_tax_minor: null,
      payment_status: "CAPTURED",
      fulfillment_status: "UNFULFILLED",
      catalog_product_id: "prod_haru_01",
      external_product_id: "gid://shopify/ProductVariant/101",
      order_count: 1,
      ledger_transaction_count: 1,
    });
    expect(rows[0].address_ciphertext.toString("utf8")).not.toContain("花子");

    const publicStatus = await new PostgresOrderStatusQuery(sql)
      .findByCheckoutReference(checkoutId);
    expect(publicStatus).toMatchObject({
      purchaseIntentStatus: "CONVERTED",
      orderStatus: "CONFIRMED",
      paymentStatus: "CAPTURED",
      fulfillmentStatus: "UNFULFILLED",
      productName: "春のひかり",
      quantity: 1,
      deliveryDate: "2026-08-28",
      total: money(7100),
    });
    expect(JSON.stringify(publicStatus)).not.toContain("花子");
    expect(JSON.stringify(publicStatus)).not.toContain("buyer@example.test");

    const refundEvent = {
      provider: "STRIPE" as const,
      providerAccountId: "acct_example",
      externalEventId: `evt_refund_${intentId}`,
      eventType: "refund.updated",
      externalObjectId: `re_${intentId.replaceAll("-", "")}`,
      apiVersion: "2026-07-29.dahlia",
      occurredAt: new Date("2026-08-21T01:00:00.000Z"),
      payload: {
        objectType: "refund",
        id: `re_${intentId.replaceAll("-", "")}`,
        paymentIntentId,
        amount: 1000,
        currency: "jpy",
        status: "succeeded",
        reason: "requested_by_customer",
        failureReason: null,
      },
    };
    await processor.process(refundEvent);
    await processor.process(refundEvent);
    const refundRows = await sql`
      SELECT
        payments.status,
        payments.amount_refunded_minor,
        (SELECT COUNT(*)::integer FROM bloombox.refunds WHERE payment_id = payments.id) AS refund_count,
        (SELECT COUNT(*)::integer FROM bloombox.financial_transactions
          WHERE payment_id = payments.id AND transaction_type = 'REFUND') AS refund_ledger_count
      FROM bloombox.payments
      WHERE external_payment_id = ${paymentIntentId}
    `;
    expect(refundRows[0]).toEqual({
      status: "PARTIALLY_REFUNDED",
      amount_refunded_minor: "1000",
      refund_count: 1,
      refund_ledger_count: 1,
    });

    await processor.process({
      ...refundEvent,
      externalEventId: `evt_refund_delayed_${intentId}`,
      eventType: "refund.created",
      occurredAt: new Date("2026-08-21T00:50:00.000Z"),
      payload: { ...refundEvent.payload, status: "pending" },
    });
    const delayedRefundRows = await sql`
      SELECT
        refunds.status AS refund_status,
        payments.status AS payment_status,
        (SELECT COUNT(*)::integer FROM bloombox.financial_transactions
          WHERE payment_id = payments.id AND transaction_type = 'REFUND') AS refund_ledger_count
      FROM bloombox.refunds
      JOIN bloombox.payments ON payments.id = refunds.payment_id
      WHERE refunds.external_refund_id = ${refundEvent.externalObjectId}
    `;
    expect(delayedRefundRows[0]).toEqual({
      refund_status: "SUCCEEDED",
      payment_status: "PARTIALLY_REFUNDED",
      refund_ledger_count: 1,
    });

    await expect(processor.process({
      ...refundEvent,
      externalEventId: `evt_refund_invalid_${intentId}`,
      occurredAt: new Date("2026-08-21T01:10:00.000Z"),
      payload: { ...refundEvent.payload, amount: 2000 },
    })).rejects.toThrow("Stripe commerce event is inconsistent with persisted state");

    const disputeId = `dp_${intentId.replaceAll("-", "")}`;
    const disputeCreated = {
      provider: "STRIPE" as const,
      providerAccountId: "acct_example",
      externalEventId: `evt_dispute_created_${intentId}`,
      eventType: "charge.dispute.created",
      externalObjectId: disputeId,
      apiVersion: "2026-07-29.dahlia",
      occurredAt: new Date("2026-08-21T02:00:00.000Z"),
      payload: {
        objectType: "dispute",
        id: disputeId,
        paymentIntentId,
        amount: 7100,
        currency: "jpy",
        reason: "fraudulent",
        status: "needs_response",
      },
    };
    await processor.process(disputeCreated);
    await processor.process({
      ...disputeCreated,
      externalEventId: `evt_dispute_closed_${intentId}`,
      eventType: "charge.dispute.closed",
      occurredAt: new Date("2026-08-21T03:00:00.000Z"),
      payload: { ...disputeCreated.payload, status: "won" },
    });
    await processor.process({
      ...disputeCreated,
      externalEventId: `evt_dispute_delayed_${intentId}`,
      occurredAt: new Date("2026-08-21T02:30:00.000Z"),
      payload: { ...disputeCreated.payload, status: "under_review" },
    });
    const disputeRows = await sql`
      SELECT disputes.status AS dispute_status, payments.status AS payment_status
      FROM bloombox.disputes
      JOIN bloombox.payments ON payments.id = disputes.payment_id
      WHERE disputes.external_dispute_id = ${disputeId}
    `;
    expect(disputeRows[0]).toEqual({
      dispute_status: "WON",
      payment_status: "PARTIALLY_REFUNDED",
    });

    const stripeConfig: StripeConfig = {
      mode: "test",
      checkoutSecretKey: "rk_test_checkout_example",
      reconciliationSecretKey: "rk_test_reconciliation_example",
      webhookSecret: "whsec_example_only_123",
      accountId: "acct_example",
      shippingRateId: "shr_example",
      taxBehavior: "inclusive",
      automaticTaxEnabled: true,
      termsAcceptance: "required",
      allowedCheckoutHostnames: ["checkout.stripe.com"],
      publicOrigin: "http://localhost:3000",
      apiVersion: "2026-07-29.dahlia",
    };
    const reconciledEvent = {
      id: `evt_reconciled_${intentId}`,
      object: "event",
      account: "acct_example",
      api_version: stripeConfig.apiVersion,
      created: 1_787_270_400,
      livemode: false,
      data: {
        object: {
          id: checkoutId,
          client_reference_id: intentId,
          payment_intent: paymentIntentId,
          payment_status: "paid",
          status: "complete",
          amount_total: 7100,
          amount_subtotal: 6600,
          currency: "jpy",
          total_details: { amount_discount: 0, amount_shipping: 500, amount_tax: 600 },
          customer: null,
          customer_details: null,
          collected_information: null,
          metadata: { purchase_intent_id: intentId },
        },
      },
      type: "checkout.session.completed",
    };
    const eventSource = {
      async *list() {
        yield reconciledEvent;
      },
    };
    const inbox = new PostgresWebhookInbox(
      sql,
      protector,
      randomUUID,
      () => new Date("2026-08-21T02:00:00.000Z"),
    );
    const reconciler = new StripeEventReconciler(
      sql,
      new StripeWebhookVerifier(stripeConfig),
      inbox,
      stripeConfig,
      () => new Date("2026-08-21T02:00:00.000Z"),
      randomUUID,
      eventSource,
    );

    await expect(reconciler.execute()).resolves.toEqual({
      checked: 1,
      relevant: 1,
      discovered: 1,
    });
    await expect(new ProcessProviderInbox(
      inbox,
      processor,
      () => new Date("2026-08-21T02:01:00.000Z"),
      () => "integration-worker",
    ).execute()).resolves.toEqual({
      claimed: 1,
      processed: 1,
      retryScheduled: 0,
      failed: 0,
    });
    const reconciliationRows = await sql`
      SELECT status, checked_count, difference_count
      FROM bloombox.reconciliation_runs
      WHERE commerce_provider = 'STRIPE'
      ORDER BY started_at DESC
      LIMIT 1
    `;
    expect(reconciliationRows[0]).toEqual({
      status: "SUCCEEDED",
      checked_count: 1,
      difference_count: 1,
    });
  });

  it("keeps runtime roles least-privileged and append-only", async () => {
    const rows = await sql`
      SELECT
        has_table_privilege('bloombox_worker', 'bloombox.ledger_entries', 'INSERT') AS worker_can_insert_ledger,
        has_table_privilege('bloombox_worker', 'bloombox.ledger_entries', 'UPDATE') AS worker_can_update_ledger,
        has_table_privilege('bloombox_application', 'bloombox.outbox_events', 'INSERT') AS app_can_insert_outbox,
        has_table_privilege('bloombox_application', 'bloombox.outbox_events', 'DELETE') AS app_can_delete_outbox
    `;

    expect(rows[0]).toEqual({
      worker_can_insert_ledger: true,
      worker_can_update_ledger: false,
      app_can_insert_outbox: true,
      app_can_delete_outbox: false,
    });
  });

  it("encrypts provider payloads and deduplicates inbox events", async () => {
    const event = {
      provider: "STRIPE" as const,
      providerAccountId: "acct_example",
      externalEventId: "evt_duplicate_123",
      eventType: "checkout.session.completed",
      externalObjectId: "cs_test_123",
      apiVersion: "2026-07-29.dahlia",
      occurredAt: new Date("2026-08-21T00:10:00.000Z"),
      payload: { recipientName: "山田 花子", purchaseIntentId: randomUUID() },
    };
    const inbox = new PostgresWebhookInbox(sql, protector, randomUUID, () => event.occurredAt);

    await expect(inbox.record(event)).resolves.toBe("INSERTED");
    await expect(inbox.record(event)).resolves.toBe("DUPLICATE");
    const claimed = await inbox.claim({
      limit: 10,
      workerId: "worker-retry-test",
      now: new Date("2026-08-21T00:11:00.000Z"),
      lockTimeoutMinutes: 5,
    });
    expect(claimed).toEqual([event]);
    await expect(inbox.markFailed(
      event,
      "DependencyUnavailableError",
      new Date("2026-08-21T00:11:00.000Z"),
      "worker-retry-test",
    )).resolves.toBe("RETRY_SCHEDULED");
    await expect(inbox.claim({
      limit: 10,
      workerId: "worker-too-early",
      now: new Date("2026-08-21T00:11:00.500Z"),
      lockTimeoutMinutes: 5,
    })).resolves.toEqual([]);
    const retried = await inbox.claim({
      limit: 10,
      workerId: "worker-retry-success",
      now: new Date("2026-08-21T00:11:02.000Z"),
      lockTimeoutMinutes: 5,
    });
    expect(retried).toEqual([event]);
    await inbox.markProcessed(
      event,
      new Date("2026-08-21T00:11:03.000Z"),
      "worker-retry-success",
    );
    const rows = await sql`
      SELECT status, attempts, payload_ciphertext, payload_expires_at
      FROM bloombox.webhook_inbox
      WHERE external_event_id = ${event.externalEventId}
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PROCESSED");
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].payload_ciphertext.toString("utf8")).not.toContain("花子");
    expect(new Date(rows[0].payload_expires_at).toISOString()).toBe("2026-09-20T00:10:00.000Z");
  });

  it("purges expired transient PII without deleting commerce evidence", async () => {
    const intentId = purchaseIntentId(randomUUID());
    const createdAt = new Date("2026-06-01T00:00:00.000Z");
    const intent = PurchaseIntent.create({
      id: intentId,
      displayId: `BBI-20260601-${intentId.slice(0, 4).toUpperCase()}`,
      item: {
        productId: catalogProductReference("prod_retention_01"),
        externalProductReference: commerceProductReference("gid://shopify/ProductVariant/999"),
        productName: "保存期限テスト",
        quantity: 1,
        unitPriceSnapshot: money(5000),
        subtotal: money(5000),
      },
      recipient: { name: recipientName("期限 太郎"), deliveryDate: "2026-06-08" },
      giftMessage: giftMessage("保存期限の確認"),
      createdAt,
    });
    intent.transitionTo("READY_FOR_CHECKOUT");
    const repository = new PostgresPurchaseIntentRepository(sql, protector);
    await repository.save(intent);

    const providerEvent = {
      provider: "STRIPE" as const,
      providerAccountId: "acct_example",
      externalEventId: `evt_retention_${intentId}`,
      eventType: "payment_intent.succeeded",
      externalObjectId: `pi_${intentId.replaceAll("-", "")}`,
      apiVersion: "2026-07-29.dahlia",
      occurredAt: new Date("2026-06-01T00:10:00.000Z"),
      payload: { objectType: "payment_intent", status: "succeeded" },
    };
    const inbox = new PostgresWebhookInbox(sql, protector, randomUUID, () => createdAt);
    await inbox.record(providerEvent);
    const claimed = await inbox.claim({
      limit: 1,
      workerId: "retention-worker",
      now: new Date("2026-06-01T00:11:00.000Z"),
      lockTimeoutMinutes: 5,
    });
    expect(claimed).toHaveLength(1);
    await inbox.markProcessed(
      providerEvent,
      new Date("2026-06-01T00:11:00.000Z"),
      "retention-worker",
    );

    const result = await new PostgresDataRetentionJob(sql).execute(
      new Date("2026-07-02T00:00:00.000Z"),
    );
    const rows = await sql`
      SELECT
        intent.id,
        intent.status,
        intent.pii_key_id,
        intent.recipient_ciphertext,
        intent.gift_message_ciphertext,
        intent.pii_purged_at,
        inbox.external_event_id,
        inbox.status AS inbox_status,
        inbox.payload_key_id,
        inbox.payload_ciphertext,
        inbox.payload_purged_at
      FROM bloombox.purchase_intents AS intent
      JOIN bloombox.webhook_inbox AS inbox
        ON inbox.external_event_id = ${providerEvent.externalEventId}
      WHERE intent.id = ${intentId}
    `;

    expect(result.purchaseIntentsExpired).toBeGreaterThanOrEqual(1);
    expect(result.webhookPayloadsPurged).toBeGreaterThanOrEqual(1);
    expect(result.purchaseIntentPiiPurged).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({
      id: intentId,
      status: "EXPIRED",
      pii_key_id: null,
      recipient_ciphertext: null,
      gift_message_ciphertext: null,
      external_event_id: providerEvent.externalEventId,
      inbox_status: "PROCESSED",
      payload_key_id: null,
      payload_ciphertext: null,
    });
    expect(rows[0].pii_purged_at).toBeTruthy();
    expect(rows[0].payload_purged_at).toBeTruthy();
    await expect(repository.findById(intentId)).resolves.toBeNull();
    const lifecycleRows = await sql`
      SELECT
        (SELECT COUNT(*)::integer FROM bloombox.outbox_events
          WHERE aggregate_id = ${intentId} AND event_type = 'checkout.purchase_intent.expired') AS outbox_count,
        (SELECT COUNT(*)::integer FROM bloombox.audit_logs
          WHERE resource_id = ${intentId} AND action = 'checkout.purchase_intent.expired') AS audit_count
    `;
    expect(lifecycleRows[0]).toEqual({ outbox_count: 1, audit_count: 1 });
  });
});

function runMigrations(): void {
  execFileSync("node", ["scripts/migrate-database.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL_MODE: "disable",
    },
    stdio: "pipe",
  });
}

function assertSafeTestDatabaseUrl(value: string | undefined): string {
  if (!value) return "postgres://invalid/test_missing";
  const url = new URL(value);
  const databaseName = url.pathname.slice(1);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !databaseName.includes("test")) {
    throw new Error("TEST_DATABASE_URL must target a local database whose name contains test");
  }
  return value;
}
