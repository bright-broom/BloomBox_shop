import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { FulfillmentOperatorIdentity } from "../application/approve-shopify-fulfillment";
import { FulfillmentReviewError, type FulfillmentReview, type FulfillmentReviewQuery } from "../application/read-fulfillment-review";
import { FULFILLMENT_STATUSES } from "../domain/fulfillment-status";
import { FULFILLMENT_STOCK_MAX_AGE_MS } from "../domain/shopify-fulfillment-stock";
import { fulfillmentStockAssessmentSchema } from "./shopify-fulfillment-stock-schema";
import { fulfillmentQuantityAssessmentSchema } from "./shopify-fulfillment-quantities-schema";

const integer = z.union([z.number(), z.string().regex(/^\d+$/), z.bigint()]).transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const date = z.iso.datetime({ offset: true });
const recordSchema = z.object({
  fulfillment_id: z.uuid(), order_id: z.uuid(), version: integer, updated_at: z.date(), status: z.enum(FULFILLMENT_STATUSES),
  order_status: z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"]),
  reason_code: z.string().regex(/^[A-Z_]{1,80}$/), delivery_date: z.iso.date(), total_minor: integer,
  captured_minor: integer, refunded_minor: integer, payment_current: z.boolean(), test_mode: z.string(),
  items: z.array(z.object({ name: z.string().min(1).max(500), quantity: integer })).min(1).max(100),
  provider_stock_assessment: fulfillmentStockAssessmentSchema.nullable(), checked_at: date.nullable(),
  provider_quantity_assessment: fulfillmentQuantityAssessmentSchema,
  approval_at: z.date().nullable(), approval_expires: z.date().nullable(), approval_version: integer.nullable(),
});

/** Request-scoped, uncached read. A review is never an approval or a fresh provider observation. */
export class PostgresFulfillmentReviewQuery implements FulfillmentReviewQuery {
  constructor(private readonly sql: DatabaseClient, private readonly expectedTestMode: boolean,
    private readonly identity: FulfillmentOperatorIdentity = { current: async () => null },
    private readonly now: () => Date = () => new Date()) {}

  async find(input: Readonly<{ shop: string; fulfillmentId: string }>): Promise<FulfillmentReview | null> {
    const parsed = z.object({ shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/), fulfillmentId: z.uuid() }).strict().safeParse(input);
    if (!parsed.success) throw new FulfillmentReviewError("INVALID_REQUEST");
    const value = parsed.data;
    try {
      const authenticated = z.object({ operatorId: z.uuid(), expiresAt: z.date() }).safeParse(await this.identity.current());
      if (!authenticated.success) throw new FulfillmentReviewError("NOT_AUTHORIZED");
      const actor = authenticated.data;
      return await this.sql.begin(async (tx) => {
        // Serialize this read with permission revocation. The order data is read in one statement/snapshot.
        const [permission] = await tx`SELECT enabled, created_at, valid_until FROM bloombox.fulfillment_operator_permissions
          WHERE operator_id = ${actor.operatorId} AND provider_scope = ${value.shop} FOR SHARE`;
        const authorizedAt = z.date().parse(this.now());
        if (!permission || permission.enabled !== true || z.date().parse(permission.created_at) > authorizedAt
          || z.date().parse(permission.valid_until) <= authorizedAt || actor.expiresAt <= authorizedAt) {
          throw new FulfillmentReviewError("NOT_AUTHORIZED");
        }
        const [raw] = await tx`SELECT intake.fulfillment_id, intake.order_id, intake.version, intake.updated_at, intake.reason_code,
          fulfillment.status, orders.status AS order_status, gift.delivery_date::text, orders.total_minor, evidence.captured_minor, evidence.refunded_minor,
          evidence.snapshot->>'test' AS test_mode,
          COALESCE(intake.payment_evidence_version = evidence.version AND projection.evidence_version = evidence.version
            AND payment.status = evidence.status AND payment.amount_captured_minor = evidence.captured_minor
            AND payment.amount_refunded_minor = evidence.refunded_minor, false) AS payment_current,
          intake.provider_stock_assessment, intake.provider_stock_source->>'checkedAt' AS checked_at, intake.provider_quantity_assessment,
          (SELECT jsonb_agg(jsonb_build_object('name', item.product_name_snapshot, 'quantity', item.quantity) ORDER BY item.id)
            FROM bloombox.order_items AS item WHERE item.order_id = orders.id) AS items,
          approval.approved_at AS approval_at, approval.expires_at AS approval_expires, approval.intake_version AS approval_version
          FROM bloombox.shopify_fulfillment_intakes AS intake
          JOIN bloombox.fulfillments AS fulfillment ON fulfillment.id = intake.fulfillment_id AND fulfillment.order_id = intake.order_id
          JOIN bloombox.orders AS orders ON orders.id = intake.order_id AND orders.purchase_intent_id = intake.purchase_intent_id
            AND orders.commerce_provider = 'SHOPIFY' AND orders.external_order_id = intake.external_order_id AND orders.currency = 'JPY'
          JOIN bloombox.order_gift_snapshots AS gift ON gift.order_id = intake.order_id
          JOIN bloombox.shopify_payment_evidence AS evidence ON evidence.purchase_intent_id = intake.purchase_intent_id
            AND evidence.provider_scope = intake.provider_scope AND evidence.external_order_id = intake.external_order_id
          LEFT JOIN bloombox.shopify_payment_projections AS projection ON projection.order_id = intake.order_id
            AND projection.purchase_intent_id = intake.purchase_intent_id AND projection.provider_scope = intake.provider_scope
            AND projection.external_order_id = intake.external_order_id
          LEFT JOIN bloombox.payments AS payment ON payment.id = projection.payment_id AND payment.order_id = intake.order_id AND payment.commerce_provider = 'SHOPIFY'
          LEFT JOIN LATERAL (SELECT approved_at, expires_at, intake_version FROM bloombox.fulfillment_operator_approvals
            WHERE fulfillment_id = intake.fulfillment_id ORDER BY intake_version DESC LIMIT 1) AS approval ON true
          WHERE intake.fulfillment_id = ${value.fulfillmentId} AND intake.provider_scope = ${value.shop}`;
        const now = z.date().parse(this.now());
        if (actor.expiresAt <= now || z.date().parse(permission.valid_until) <= now) throw new FulfillmentReviewError("NOT_AUTHORIZED");
        if (!raw) return null;
        const row = recordSchema.parse(raw);
        if (row.test_mode !== String(this.expectedTestMode)) return null;
        const checkedAt = row.checked_at;
        const expiresAt = checkedAt ? new Date(Date.parse(checkedAt) + FULFILLMENT_STOCK_MAX_AGE_MS).toISOString() : null;
        const fresh = checkedAt !== null && expiresAt !== null && Date.parse(checkedAt) <= now.getTime() && now.getTime() < Date.parse(expiresAt);
        const assessment = row.provider_stock_assessment ?? { status: "UNVERIFIED", reason: "NOT_CONFIGURED" } as const;
        return { fulfillmentId: row.fulfillment_id, orderId: row.order_id, intakeVersion: row.version,
          observedAt: row.updated_at.toISOString(), viewedAt: now.toISOString(), status: row.status, orderStatus: row.order_status, reason: row.reason_code,
          deliveryDate: row.delivery_date, totalMinor: row.total_minor, capturedMinor: row.captured_minor, refundedMinor: row.refunded_minor,
          paymentEvidenceCurrent: row.payment_current, items: row.items, quantities: row.provider_quantity_assessment,
          stock: { ...(fresh ? assessment : { status: "UNVERIFIED", reason: checkedAt ? "STALE_SNAPSHOT" : "NOT_CONFIGURED" } as const), checkedAt, expiresAt },
          latestApproval: row.approval_at && row.approval_expires && row.approval_version !== null
            ? { recordedAt: row.approval_at.toISOString(), expiresAt: row.approval_expires.toISOString(), intakeVersion: row.approval_version } : null,
        };
      });
    } catch (error) {
      if (error instanceof FulfillmentReviewError) throw error;
      throw new FulfillmentReviewError("UNAVAILABLE");
    }
  }
}
