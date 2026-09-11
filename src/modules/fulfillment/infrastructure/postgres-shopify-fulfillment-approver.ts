import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { FulfillmentApprovalError, type FulfillmentApprovalReceipt, type FulfillmentApprovalRequest,
  type FulfillmentOperatorIdentity, type ShopifyFulfillmentApprover } from "../application/approve-shopify-fulfillment";
import { assessFulfillmentIntake, FULFILLMENT_INTAKE_POLICY, type FulfillmentIntakePolicy } from "../domain/shopify-fulfillment-intake";
import { assessFulfillmentStock, FULFILLMENT_STOCK_MAX_AGE_MS } from "../domain/shopify-fulfillment-stock";
import { reconcileFulfillmentQuantities } from "../domain/shopify-fulfillment-quantities";
import { shopifyFulfillmentObservationSchema } from "./shopify-fulfillment-observation-schema";
import { acceptedFulfillmentItemsSchema, shopifyFulfillmentQuantitiesSchema } from "./shopify-fulfillment-quantities-schema";
import { parseShopifyFulfillmentStockSnapshot } from "./shopify-fulfillment-stock-schema";

const integer = z.union([z.number(), z.string().regex(/^\d+$/), z.bigint()]).transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const requestSchema = z.object({ shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  fulfillmentId: z.uuid(), reviewedIntakeVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), idempotencyKey: z.uuid() }).strict();
const identitySchema = z.object({ operatorId: z.uuid(), expiresAt: z.date() });
function review(): never { throw new FulfillmentApprovalError("REVIEW_REQUIRED"); }

/** No provider call, fulfillment transition, inventory mutation or dispatch instruction. */
export class PostgresShopifyFulfillmentApprover implements ShopifyFulfillmentApprover {
  constructor(private readonly sql: DatabaseClient, private readonly expectedTestMode: boolean,
    private readonly identity: FulfillmentOperatorIdentity = { current: async () => null },
    private readonly policy: FulfillmentIntakePolicy = FULFILLMENT_INTAKE_POLICY,
    private readonly now: () => Date = () => new Date()) {}

  async approve(input: FulfillmentApprovalRequest): Promise<FulfillmentApprovalReceipt> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new FulfillmentApprovalError("INVALID_REQUEST");
    const value = parsed.data;
    try {
      const authenticated = identitySchema.safeParse(await this.identity.current());
      if (!authenticated.success) throw new FulfillmentApprovalError("NOT_AUTHORIZED");
      const actor = authenticated.data;
      return await this.sql.begin(async (tx) => {
        // Lock authorization first: revocation is serialized with the decision, not cached in a session role claim.
        const [permission] = await tx`SELECT * FROM bloombox.fulfillment_operator_permissions
          WHERE operator_id = ${actor.operatorId} AND provider_scope = ${value.shop} FOR SHARE`;
        const authorizationTime = z.date().parse(this.now());
        if (!permission || !permission.enabled || z.date().parse(permission.created_at) > authorizationTime
          || z.date().parse(permission.valid_until) <= authorizationTime || actor.expiresAt <= authorizationTime) {
          throw new FulfillmentApprovalError("NOT_AUTHORIZED");
        }
        const [reference] = await tx`SELECT purchase_intent_id FROM bloombox.shopify_fulfillment_intakes
          WHERE fulfillment_id = ${value.fulfillmentId} AND provider_scope = ${value.shop}`;
        if (!reference) review();
        // Same payment-parent lock order as intake/projector. Never mutate another module's tables.
        const [evidence] = await tx`SELECT * FROM bloombox.shopify_payment_evidence
          WHERE purchase_intent_id = ${reference.purchase_intent_id} FOR UPDATE`;
        const [intake] = await tx`SELECT * FROM bloombox.shopify_fulfillment_intakes
          WHERE fulfillment_id = ${value.fulfillmentId} FOR UPDATE`;
        if (!intake || !evidence || intake.provider_scope !== value.shop || evidence.provider_scope !== value.shop
          || intake.purchase_intent_id !== reference.purchase_intent_id || evidence.external_order_id !== intake.external_order_id
          || integer.parse(intake.version) !== value.reviewedIntakeVersion
          || intake.payment_evidence_version !== evidence.version || intake.decision !== "HELD"
          || intake.observed_status !== "UNFULFILLED" || intake.reason_code !== "DISPATCH_APPROVAL_REQUIRED") review();
        const [row] = await tx`SELECT fulfillment.status AS fulfillment_status, orders.status AS order_status, orders.currency, orders.total_minor,
          projection.evidence_version AS projection_version, payment.status AS payment_status,
          payment.amount_captured_minor, payment.amount_refunded_minor, gift.delivery_date::text, gift.retention_expires_at,
          (gift.address_ciphertext IS NOT NULL AND gift.recipient_ciphertext IS NOT NULL AND gift.gift_message_ciphertext IS NOT NULL) AS address_available
          FROM bloombox.fulfillments AS fulfillment
          JOIN bloombox.orders AS orders ON orders.id = fulfillment.order_id
          JOIN bloombox.order_gift_snapshots AS gift ON gift.order_id = orders.id
          JOIN bloombox.shopify_payment_projections AS projection ON projection.order_id = orders.id
            AND projection.purchase_intent_id = ${reference.purchase_intent_id} AND projection.provider_scope = ${value.shop}
            AND projection.external_order_id = ${intake.external_order_id}
          JOIN bloombox.payments AS payment ON payment.id = projection.payment_id AND payment.order_id = orders.id AND payment.commerce_provider = 'SHOPIFY'
          WHERE fulfillment.id = ${value.fulfillmentId} AND orders.id = ${intake.order_id}
            AND orders.purchase_intent_id = ${reference.purchase_intent_id} AND orders.commerce_provider = 'SHOPIFY'
            AND orders.external_order_id = ${intake.external_order_id}
          FOR SHARE OF fulfillment, orders, gift, projection, payment`;
        if (!row || row.currency !== "JPY" || row.fulfillment_status !== "UNFULFILLED"
          || row.projection_version !== evidence.version || row.payment_status !== evidence.status) review();
        // Read the clock after waiting for locks: neither a blocked request nor a retry extends evidence validity.
        const now = z.date().parse(this.now());
        const permissionExpiry = z.date().parse(permission.valid_until);
        if (permissionExpiry <= now || actor.expiresAt <= now) throw new FulfillmentApprovalError("NOT_AUTHORIZED");
        const source = z.object({ test: z.boolean(), updatedAt: z.iso.datetime({ offset: true }), cancelledAt: z.iso.datetime({ offset: true }).nullable(),
          requested: integer, received: integer, refunded: integer,
          transactions: z.array(z.object({ status: z.enum(["PENDING", "SUCCEEDED", "FAILED"]) })).max(100) }).parse(evidence.snapshot);
        const total = integer.parse(row.total_minor);
        if (source.test !== this.expectedTestMode || source.requested !== total
          || integer.parse(evidence.captured_minor) !== source.received || integer.parse(row.amount_captured_minor) !== source.received
          || integer.parse(evidence.refunded_minor) !== source.refunded || integer.parse(row.amount_refunded_minor) !== source.refunded) review();
        const stock = parseShopifyFulfillmentStockSnapshot(intake.provider_stock_source);
        const quantities = shopifyFulfillmentQuantitiesSchema.parse(intake.provider_quantity_source);
        if (stock.shop !== value.shop || stock.orderId !== intake.external_order_id || stock.test !== this.expectedTestMode
          || Date.parse(stock.orderUpdatedAt) !== Date.parse(quantities.updatedAt)
          || Date.parse(stock.orderUpdatedAt) !== Date.parse(source.updatedAt)) review();
        const items = acceptedFulfillmentItemsSchema.parse(await tx`SELECT external_product_id AS "variantId", quantity
          FROM bloombox.order_items WHERE order_id = ${intake.order_id}`);
        const retention = z.date().nullable().parse(row.retention_expires_at);
        const decision = assessFulfillmentIntake({ status: "UNFULFILLED",
          orderStatus: z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"]).parse(row.order_status),
          orderCancelled: source.cancelledAt !== null, total, captured: source.received, refunded: source.refunded,
          pendingTransactions: source.transactions.some((item) => item.status === "PENDING"),
          addressAvailable: row.address_available === true && retention !== null && retention > now,
          deliveryDate: z.iso.date().parse(row.delivery_date),
          providerActivity: shopifyFulfillmentObservationSchema.parse(intake.provider_observation).activity,
          stockAssessment: assessFulfillmentStock(items, stock, now),
          quantityAssessment: reconcileFulfillmentQuantities(items, quantities, quantities).assessment,
        }, this.policy, now);
        if (decision.reason !== "DISPATCH_APPROVAL_REQUIRED" || !retention) review();
        const expiresAt = new Date(Math.min(Date.parse(stock.checkedAt) + FULFILLMENT_STOCK_MAX_AGE_MS,
          actor.expiresAt.getTime(), permissionExpiry.getTime(), retention.getTime()));
        if (expiresAt <= now) review();
        const existing = await tx`SELECT * FROM bloombox.fulfillment_operator_approvals
          WHERE (operator_id = ${actor.operatorId} AND idempotency_key = ${value.idempotencyKey})
            OR (fulfillment_id = ${value.fulfillmentId} AND intake_version = ${value.reviewedIntakeVersion})`;
        if (existing.length > 1) throw new FulfillmentApprovalError("CONFLICT");
        const previous = existing[0];
        if (previous) {
          if (previous.operator_id !== actor.operatorId || previous.idempotency_key !== value.idempotencyKey
            || previous.fulfillment_id !== value.fulfillmentId || integer.parse(previous.intake_version) !== value.reviewedIntakeVersion
            || previous.permission_id !== permission.id || integer.parse(previous.permission_version) !== integer.parse(permission.version)) {
            throw new FulfillmentApprovalError("CONFLICT");
          }
          if (z.date().parse(previous.expires_at) <= now) review();
          return { outcome: "DUPLICATE", approvalId: z.uuid().parse(previous.id), fulfillmentId: value.fulfillmentId,
            intakeVersion: value.reviewedIntakeVersion, approvedAt: z.date().parse(previous.approved_at), expiresAt: previous.expires_at };
        }
        const approvalId = randomUUID();
        await tx`INSERT INTO bloombox.fulfillment_operator_approvals (id, fulfillment_id, intake_version, payment_evidence_version,
          permission_id, permission_version, operator_id, idempotency_key, approved_at, expires_at)
          VALUES (${approvalId}, ${value.fulfillmentId}, ${value.reviewedIntakeVersion}, ${evidence.version},
            ${permission.id}, ${permission.version}, ${actor.operatorId}, ${value.idempotencyKey}, ${now}, ${expiresAt})`;
        const payload = { approvalId, fulfillmentId: value.fulfillmentId, intakeVersion: value.reviewedIntakeVersion,
          paymentVersion: evidence.version, permissionId: permission.id, permissionVersion: integer.parse(permission.version), expiresAt: expiresAt.toISOString() };
        await tx`INSERT INTO bloombox.audit_logs (id, actor_type, actor_reference, action, resource_type, resource_id, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'OPERATOR', ${actor.operatorId}, 'fulfillment.operator_approval.recorded', 'Fulfillment',
            ${value.fulfillmentId}, ${tx.json(payload)}, ${now})`;
        await tx`INSERT INTO bloombox.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, available_at)
          VALUES (${randomUUID()}, 'Fulfillment', ${value.fulfillmentId}, 'fulfillment.operator_approval.recorded', 1, ${tx.json(payload)}, ${now}, ${now})`;
        return { outcome: "RECORDED", approvalId, fulfillmentId: value.fulfillmentId,
          intakeVersion: value.reviewedIntakeVersion, approvedAt: now, expiresAt };
      });
    } catch (error) {
      if (error instanceof FulfillmentApprovalError) throw error;
      if (error instanceof z.ZodError) throw new FulfillmentApprovalError("REVIEW_REQUIRED");
      if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new FulfillmentApprovalError("CONFLICT");
      throw new FulfillmentApprovalError("UNAVAILABLE");
    }
  }
}
