import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ShopifyPurchaseConversion } from "@/modules/checkout/public";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { evaluateSettlement, reconcileSettlement } from "../../domain/settlement-evidence";
import { assertPaymentTransition } from "../../domain/payment-status";
import { ShopifyOrderPaymentProjectionError, type ShopifyOrderPaymentProjector, type ShopifyOrderPaymentResult } from "../../application/project-shopify-order-payment";
import { shopifySettlementSnapshotSchema } from "./postgres-shopify-payment-evidence";

const statusSchema = z.enum(["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"]);
function fail(): never { throw new ShopifyOrderPaymentProjectionError(); }

/** Mirrors latest durable facts for an accepted order; never issues a capture or refund to a provider. */
export class PostgresShopifyOrderPaymentProjector implements ShopifyOrderPaymentProjector {
  constructor(private readonly sql: DatabaseClient, private readonly expectedTestMode: boolean,
    private readonly now: () => Date = () => new Date()) {}
  async project(input: ShopifyPurchaseConversion): Promise<ShopifyOrderPaymentResult> {
    try {
      const value = z.object({ shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
        externalOrderId: z.string().max(100).regex(/^gid:\/\/shopify\/Order\/[1-9]\d*$/),
        orderId: z.uuid(), purchaseIntentId: z.uuid(), attemptId: z.uuid() }).parse(input);
      return await this.sql.begin(async (tx) => {
        const [row] = await tx`SELECT * FROM bloombox.shopify_payment_evidence WHERE purchase_intent_id = ${value.purchaseIntentId} FOR UPDATE`;
        if (!row || row.provider_scope !== value.shop || row.external_order_id !== value.externalOrderId) fail();
        const [receipt] = await tx`SELECT orders.total_minor, orders.currency, receipt.payment_evidence_version
          FROM bloombox.shopify_order_acceptances AS receipt
          JOIN bloombox.orders AS orders ON orders.id = receipt.order_id AND orders.purchase_intent_id = receipt.purchase_intent_id
            AND orders.commerce_provider = 'SHOPIFY' AND orders.external_order_id = receipt.external_order_id
          JOIN bloombox.shopify_order_links AS link ON link.purchase_intent_id = receipt.purchase_intent_id
          WHERE receipt.order_id = ${value.orderId} AND receipt.purchase_intent_id = ${value.purchaseIntentId}
            AND receipt.provider_scope = ${value.shop} AND receipt.external_order_id = ${value.externalOrderId} AND link.attempt_id = ${value.attemptId}`;
        if (!receipt || receipt.currency !== "JPY") fail();
        const evidence = evaluateSettlement(shopifySettlementSnapshotSchema.parse(row.snapshot));
        const version = z.number().int().positive().parse(row.version);
        const status = statusSchema.parse(evidence.status);
        if (evidence.snapshot.test !== this.expectedTestMode || version < receipt.payment_evidence_version
          || String(evidence.snapshot.requested) !== String(receipt.total_minor) || evidence.captured !== evidence.snapshot.requested
          || row.status !== status || String(row.captured_minor) !== String(evidence.captured)
          || String(row.refunded_minor) !== String(evidence.refunded) || String(row.authorized_minor) !== String(evidence.authorized)) fail();
        const [projection] = await tx`SELECT * FROM bloombox.shopify_payment_projections WHERE purchase_intent_id = ${value.purchaseIntentId} FOR UPDATE`;
        const payments = await tx`SELECT * FROM bloombox.payments WHERE order_id = ${value.orderId} FOR UPDATE`;
        const old = payments[0];
        const externalPaymentId = `${value.shop}:${value.externalOrderId}`; // A scoped aggregate reference, not a fabricated charge ID.
        const previous = projection ? evaluateSettlement(shopifySettlementSnapshotSchema.parse(projection.snapshot)) : null;
        if (projection) {
          if (!previous) fail();
          if (projection.order_id !== value.orderId || projection.provider_scope !== value.shop || projection.external_order_id !== value.externalOrderId
            || projection.evidence_version > version || payments.length !== 1 || old.id !== projection.payment_id
            || old.commerce_provider !== "SHOPIFY" || old.external_payment_id !== externalPaymentId || old.currency !== "JPY"
            || old.status !== previous.status || String(old.amount_requested_minor) !== String(previous.snapshot.requested)
            || String(old.amount_authorized_minor) !== String(previous.captured + previous.authorized)
            || String(old.amount_captured_minor) !== String(previous.captured) || String(old.amount_refunded_minor) !== String(previous.refunded)) fail();
          const change = reconcileSettlement(previous, evidence.snapshot);
          if (change.outcome === "STALE") fail();
          if (projection.evidence_version === version) {
            if (change.outcome !== "DUPLICATE") fail();
            return { outcome: "DUPLICATE", paymentId: projection.payment_id, version, status };
          }
          if (previous.status !== status) assertPaymentTransition(statusSchema.parse(previous.status), status);
        } else if (payments.length) fail();
        const paymentId = projection ? z.uuid().parse(projection.payment_id) : randomUUID();
        const now = this.now();
        if (!projection) {
          await tx`INSERT INTO bloombox.payments (id, order_id, commerce_provider, external_payment_id, status,
            amount_requested_minor, amount_authorized_minor, amount_captured_minor, amount_refunded_minor, currency, created_at, updated_at)
            VALUES (${paymentId}, ${value.orderId}, 'SHOPIFY', ${externalPaymentId}, ${status}, ${evidence.snapshot.requested},
              ${evidence.captured + evidence.authorized}, ${evidence.captured}, ${evidence.refunded}, 'JPY', ${now}, ${now})`;
        } else {
          await tx`UPDATE bloombox.payments SET status = ${status}, amount_authorized_minor = ${evidence.captured + evidence.authorized},
            amount_captured_minor = ${evidence.captured}, amount_refunded_minor = ${evidence.refunded}, version = version + 1, updated_at = ${now} WHERE id = ${paymentId}`;
        }
        const recorded = new Set(previous?.snapshot.transactions.filter((item) => item.status === "SUCCEEDED").map((item) => item.id));
        for (const item of evidence.snapshot.transactions) {
          if (item.status !== "SUCCEEDED" || !["SALE", "CAPTURE", "REFUND"].includes(item.kind) || recorded.has(item.id) || item.amount === 0) continue;
          const transactionId = randomUUID();
          const refund = item.kind === "REFUND";
          const amount = refund ? -item.amount : item.amount;
          // This is the observation timestamp; provider transaction occurrence timestamps are not in the source contract.
          await tx`INSERT INTO bloombox.financial_transactions (id, order_id, payment_id, transaction_type, currency, external_reference, occurred_at)
            VALUES (${transactionId}, ${value.orderId}, ${paymentId}, ${refund ? "SHOPIFY_REFUND" : "SHOPIFY_CAPTURE"}, 'JPY', ${`${value.shop}:${item.id}`}, ${now})`;
          await tx`INSERT INTO bloombox.ledger_entries (id, financial_transaction_id, account_code, signed_amount_minor, currency)
            VALUES (${randomUUID()}, ${transactionId}, 'SHOPIFY_CLEARING', ${amount}, 'JPY'),
              (${randomUUID()}, ${transactionId}, 'ORDER_PAYMENTS', ${-amount}, 'JPY')`;
        }
        if (!previous || previous.status !== status) {
          await tx`INSERT INTO bloombox.payment_status_transitions (id, payment_id, from_status, to_status, provider_event_id, reason_code, occurred_at)
            VALUES (${randomUUID()}, ${paymentId}, ${previous?.status ?? null}, ${status}, ${`shopify-evidence:${value.purchaseIntentId}:${version}`}, 'SHOPIFY_EVIDENCE_PROJECTED', ${now})`;
        }
        if (projection) {
          await tx`UPDATE bloombox.shopify_payment_projections SET evidence_version = ${version}, snapshot = ${tx.json(evidence.snapshot)}, updated_at = ${now}
            WHERE payment_id = ${paymentId}`;
        } else {
          await tx`INSERT INTO bloombox.shopify_payment_projections (payment_id, order_id, purchase_intent_id, provider_scope, external_order_id, evidence_version, snapshot, updated_at)
            VALUES (${paymentId}, ${value.orderId}, ${value.purchaseIntentId}, ${value.shop}, ${value.externalOrderId}, ${version}, ${tx.json(evidence.snapshot)}, ${now})`;
        }
        const payload = { paymentId, orderId: value.orderId, purchaseIntentId: value.purchaseIntentId, status, evidenceVersion: version,
          captured: evidence.captured, refunded: evidence.refunded, currency: "JPY" };
        await tx`INSERT INTO bloombox.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, available_at)
          VALUES (${randomUUID()}, 'Payment', ${paymentId}, 'payment.shopify_order.projected', 1, ${tx.json(payload)}, ${now}, ${now})`;
        await tx`INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'SYSTEM', 'payment.shopify_order.projected', 'Payment', ${paymentId}, ${tx.json(payload)}, ${now})`;
        return { outcome: "APPLIED", paymentId, version, status };
      });
    } catch { throw new ShopifyOrderPaymentProjectionError(); }
  }
}
