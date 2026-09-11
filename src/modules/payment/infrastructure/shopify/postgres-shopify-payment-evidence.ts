import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ShopifyOrderLink } from "@/modules/checkout/public";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { evaluateSettlement, reconcileSettlement, SettlementEvidenceConflictError, type SettlementSnapshot } from "../../domain/settlement-evidence";
import { ShopifyPaymentEvidencePersistenceError, type ShopifyPaymentEvidenceResult, type ShopifyPaymentEvidenceStore } from "../../application/reconcile-shopify-payment";
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const shopifySettlementSnapshotSchema = z.object({
  updatedAt: z.iso.datetime({ offset: true }), cancelledAt: z.iso.datetime({ offset: true }).nullable(), test: z.boolean(),
  requested: minor, received: minor, refunded: minor,
  transactions: z.array(z.object({
    id: z.string().max(100).regex(/^gid:\/\/shopify\/OrderTransaction\/[1-9]\d*$/),
    kind: z.enum(["AUTHORIZATION", "CAPTURE", "SALE", "REFUND", "VOID", "UNSUPPORTED"]),
    status: z.enum(["PENDING", "SUCCEEDED", "FAILED"]), parentId: z.string().max(100).regex(/^gid:\/\/shopify\/OrderTransaction\/[1-9]\d*$/).nullable(), amount: minor,
  })).max(100),
});
export class PostgresShopifyPaymentEvidence implements ShopifyPaymentEvidenceStore {
  constructor(private readonly sql: DatabaseClient, private readonly now: () => Date = () => new Date()) {}
  async record(link: ShopifyOrderLink, shop: string, snapshot: SettlementSnapshot): Promise<ShopifyPaymentEvidenceResult> {
    const input = shopifySettlementSnapshotSchema.safeParse(snapshot);
    if (!input.success || !z.uuid().safeParse(link.purchaseIntentId).success
      || !z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).safeParse(shop).success
      || !z.string().max(100).regex(/^gid:\/\/shopify\/Order\/[1-9]\d*$/).safeParse(link.orderId).success) throw new SettlementEvidenceConflictError();
    const initial = evaluateSettlement(input.data);
    try {
      return await this.sql.begin(async (tx) => {
        const now = this.now();
        const inserted = await tx`INSERT INTO bloombox.shopify_payment_evidence
          (purchase_intent_id, provider_scope, external_order_id, status, captured_minor, refunded_minor, authorized_minor, snapshot, version, updated_at)
          VALUES (${link.purchaseIntentId}, ${shop}, ${link.orderId}, ${initial.status}, ${initial.captured}, ${initial.refunded}, ${initial.authorized}, ${tx.json(initial.snapshot)}, 1, ${now})
          ON CONFLICT DO NOTHING RETURNING purchase_intent_id`;
        let version = 1; let evidence = initial;
        if (!inserted.length) {
          const rows = await tx`SELECT provider_scope, external_order_id, snapshot, version FROM bloombox.shopify_payment_evidence
            WHERE purchase_intent_id = ${link.purchaseIntentId} FOR UPDATE`;
          if (rows[0]?.provider_scope !== shop || rows[0]?.external_order_id !== link.orderId) throw new SettlementEvidenceConflictError();
          version = z.number().int().positive().parse(rows[0].version);
          const previous = evaluateSettlement(shopifySettlementSnapshotSchema.parse(rows[0].snapshot));
          const result = reconcileSettlement(previous, input.data);
          if (result.outcome !== "APPLIED") return { outcome: result.outcome, status: previous.status, version };
          evidence = result.evidence; version += 1;
          await tx`UPDATE bloombox.shopify_payment_evidence SET status = ${evidence.status}, captured_minor = ${evidence.captured},
            refunded_minor = ${evidence.refunded}, authorized_minor = ${evidence.authorized}, snapshot = ${tx.json(evidence.snapshot)}, version = ${version}, updated_at = ${now}
            WHERE purchase_intent_id = ${link.purchaseIntentId}`;
        }
        const payload = { purchaseIntentId: link.purchaseIntentId, orderId: link.orderId, status: evidence.status,
          captured: evidence.captured, refunded: evidence.refunded, authorized: evidence.authorized, currency: "JPY", version, test: evidence.snapshot.test };
        await tx`INSERT INTO bloombox.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, available_at)
          VALUES (${randomUUID()}, 'ShopifyPaymentEvidence', ${link.purchaseIntentId}, 'payment.shopify_evidence.updated', 1, ${tx.json(payload)}, ${now}, ${now})`;
        await tx`INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'SYSTEM', 'payment.shopify_evidence.updated', 'ShopifyPaymentEvidence', ${link.purchaseIntentId}, ${tx.json(payload)}, ${now})`;
        return { outcome: "APPLIED", status: evidence.status, version };
      });
    } catch (error) {
      if (error instanceof SettlementEvidenceConflictError) throw error;
      if (error instanceof Error && "code" in error && ["23503", "23505"].includes(String(error.code))) throw new SettlementEvidenceConflictError();
      throw new ShopifyPaymentEvidencePersistenceError();
    }
  }
}
