import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { ShopifyFulfillmentIntakeError, type ShopifyFulfillmentIntake, type ShopifyFulfillmentReference, type ShopifyFulfillmentIntakeResult } from "../application/reconcile-shopify-fulfillment";
import { assessFulfillmentIntake, FULFILLMENT_INTAKE_POLICY, type FulfillmentIntakePolicy } from "../domain/shopify-fulfillment-intake";
import { assertFulfillmentTransition, FULFILLMENT_STATUSES } from "../domain/fulfillment-status";
import type { ShopifyFulfillmentReader } from "../application/read-shopify-fulfillments";
import { observeShopifyFulfillment } from "../domain/shopify-fulfillment-observation";
import { shopifyFulfillmentObservationSchema, shopifyFulfillmentSnapshotSchema } from "./shopify-fulfillment-observation-schema";

const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const storedInteger = z.union([z.number(), z.string().regex(/^\d+$/), z.bigint()]).transform(Number).pipe(minor);
function fail(): never { throw new ShopifyFulfillmentIntakeError(); }

/** Provider read precedes the transaction. Writes only Fulfillment-owned intake and observation, never dispatch. */
export class PostgresShopifyFulfillmentIntake implements ShopifyFulfillmentIntake {
  constructor(private readonly sql: DatabaseClient, private readonly expectedTestMode: boolean,
    private readonly policy: FulfillmentIntakePolicy = FULFILLMENT_INTAKE_POLICY,
    private readonly now: () => Date = () => new Date(), private readonly reader?: ShopifyFulfillmentReader) {}
  async reconcile(input: ShopifyFulfillmentReference): Promise<ShopifyFulfillmentIntakeResult> {
    try {
      const value = z.object({ shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
        externalOrderId: z.string().max(100).regex(/^gid:\/\/shopify\/Order\/[1-9]\d*$/),
        orderId: z.uuid(), purchaseIntentId: z.uuid(), attemptId: z.uuid() }).parse(input);
      const snapshot = this.reader ? shopifyFulfillmentSnapshotSchema.parse(await this.reader.readFulfillments({
        shop: value.shop, orderId: value.externalOrderId, test: this.expectedTestMode,
      })) : null;
      if (snapshot && (snapshot.shop !== value.shop || snapshot.orderId !== value.externalOrderId || snapshot.test !== this.expectedTestMode)) fail();
      return await this.sql.begin(async (tx) => {
        // Serialize intake and financial updates on the existing parent; no other module's data is changed.
        const [evidence] = await tx`SELECT * FROM bloombox.shopify_payment_evidence WHERE purchase_intent_id = ${value.purchaseIntentId} FOR UPDATE`;
        if (!evidence || evidence.provider_scope !== value.shop || evidence.external_order_id !== value.externalOrderId) fail();
        const [row] = await tx`SELECT orders.status AS order_status, orders.currency, orders.total_minor, intent.status AS purchase_status,
          receipt.payment_evidence_version AS acceptance_version, projection.evidence_version AS projection_version,
          payment.status AS payment_status, payment.amount_captured_minor, payment.amount_refunded_minor,
          gift.delivery_date::text, gift.retention_expires_at,
          (gift.address_ciphertext IS NOT NULL AND gift.recipient_ciphertext IS NOT NULL AND gift.gift_message_ciphertext IS NOT NULL) AS address_available
          FROM bloombox.shopify_order_acceptances AS receipt
          JOIN bloombox.orders AS orders ON orders.id = receipt.order_id AND orders.purchase_intent_id = receipt.purchase_intent_id
            AND orders.commerce_provider = 'SHOPIFY' AND orders.external_order_id = receipt.external_order_id
          JOIN bloombox.purchase_intents AS intent ON intent.id = receipt.purchase_intent_id AND intent.commerce_provider = 'SHOPIFY'
          JOIN bloombox.shopify_order_links AS link ON link.purchase_intent_id = receipt.purchase_intent_id
          JOIN bloombox.order_gift_snapshots AS gift ON gift.order_id = receipt.order_id
          JOIN bloombox.shopify_payment_projections AS projection ON projection.order_id = receipt.order_id AND projection.purchase_intent_id = receipt.purchase_intent_id
            AND projection.provider_scope = receipt.provider_scope AND projection.external_order_id = receipt.external_order_id
          JOIN bloombox.payments AS payment ON payment.id = projection.payment_id AND payment.order_id = receipt.order_id AND payment.commerce_provider = 'SHOPIFY'
          WHERE receipt.order_id = ${value.orderId} AND receipt.purchase_intent_id = ${value.purchaseIntentId}
            AND receipt.provider_scope = ${value.shop} AND receipt.external_order_id = ${value.externalOrderId} AND link.attempt_id = ${value.attemptId}
          FOR SHARE OF projection, payment`;
        if (!row || row.currency !== "JPY" || row.purchase_status !== "CONVERTED") fail();
        const paymentVersion = z.number().int().positive().parse(evidence.version);
        if (row.projection_version !== paymentVersion || paymentVersion < row.acceptance_version || row.payment_status !== evidence.status) fail();
        const source = z.object({ test: z.boolean(), cancelledAt: z.iso.datetime({ offset: true }).nullable(), requested: minor, received: minor, refunded: minor,
          transactions: z.array(z.object({ status: z.enum(["PENDING", "SUCCEEDED", "FAILED"]) })).max(100) }).parse(evidence.snapshot);
        const total = storedInteger.parse(row.total_minor);
        if (source.test !== this.expectedTestMode || source.requested !== total
          || storedInteger.parse(evidence.captured_minor) !== source.received || storedInteger.parse(row.amount_captured_minor) !== source.received
          || storedInteger.parse(evidence.refunded_minor) !== source.refunded || storedInteger.parse(row.amount_refunded_minor) !== source.refunded) fail();
        const [previous] = await tx`SELECT * FROM bloombox.shopify_fulfillment_intakes WHERE order_id = ${value.orderId} FOR UPDATE`;
        const fulfillments = await tx`SELECT id, status FROM bloombox.fulfillments WHERE order_id = ${value.orderId} FOR UPDATE`;
        if (fulfillments.length > 1 || (!previous && fulfillments.length)) fail();
        if (previous && (fulfillments.length !== 1 || previous.fulfillment_id !== fulfillments[0].id
          || previous.purchase_intent_id !== value.purchaseIntentId || previous.provider_scope !== value.shop
          || previous.external_order_id !== value.externalOrderId || previous.payment_evidence_version > paymentVersion)) fail();
        const currentStatus = fulfillments.length ? z.enum(FULFILLMENT_STATUSES).parse(fulfillments[0].status) : null;
        const previousObservation = shopifyFulfillmentObservationSchema.parse(previous?.provider_observation ?? { activity: "UNVERIFIED", witness: null });
        const observation = observeShopifyFulfillment(previousObservation, snapshot?.fulfillments ?? null);
        // A previous empty read cannot justify cancellation when the reader is no longer configured.
        const providerActivity = snapshot === null && observation.activity === "NONE" ? "UNVERIFIED" : observation.activity;
        const now = this.now();
        const retention = z.date().nullable().parse(row.retention_expires_at);
        const decision = assessFulfillmentIntake({ status: currentStatus, providerActivity,
          orderStatus: z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"]).parse(row.order_status),
          orderCancelled: source.cancelledAt !== null, total, captured: source.received, refunded: source.refunded,
          pendingTransactions: source.transactions.some((item) => item.status === "PENDING"),
          addressAvailable: row.address_available === true && retention !== null && retention > now,
          deliveryDate: z.iso.date().parse(row.delivery_date) }, this.policy, now);
        const status = decision.kind === "CANCELLED" ? "CANCELLED" : currentStatus ?? "UNFULFILLED";
        const fulfillmentId = previous ? z.uuid().parse(previous.fulfillment_id) : randomUUID();
        if (previous && previous.payment_evidence_version === paymentVersion && previous.decision === decision.kind
          && previous.reason_code === decision.reason && previous.observed_status === status && previousObservation.activity === observation.activity) {
          return { outcome: "DUPLICATE", fulfillmentId, status, decision, providerActivity };
        }
        const version = previous ? storedInteger.parse(previous.version) + 1 : 1;
        if (!Number.isSafeInteger(version)) fail();
        if (!previous) {
          await tx`INSERT INTO bloombox.fulfillments (id, order_id, status, created_at, updated_at)
            VALUES (${fulfillmentId}, ${value.orderId}, ${status}, ${now}, ${now})`;
        } else if (currentStatus !== status) {
          if (!currentStatus) fail();
          assertFulfillmentTransition(currentStatus, status);
          await tx`UPDATE bloombox.fulfillments SET status = ${status}, version = version + 1, updated_at = ${now} WHERE id = ${fulfillmentId}`;
        }
        if (currentStatus !== status) {
          await tx`INSERT INTO bloombox.fulfillment_status_transitions (id, fulfillment_id, from_status, to_status, reason_code, idempotency_key, occurred_at)
            VALUES (${randomUUID()}, ${fulfillmentId}, ${currentStatus}, ${status}, ${decision.reason}, ${`shopify-intake:${fulfillmentId}:${version}`}, ${now})`;
        }
        if (previous) {
          await tx`UPDATE bloombox.shopify_fulfillment_intakes SET payment_evidence_version = ${paymentVersion}, version = ${version},
            provider_observation = ${tx.json(observation)},
            decision = ${decision.kind}, observed_status = ${status}, reason_code = ${decision.reason}, updated_at = ${now} WHERE fulfillment_id = ${fulfillmentId}`;
        } else {
          await tx`INSERT INTO bloombox.shopify_fulfillment_intakes (fulfillment_id, order_id, purchase_intent_id, provider_scope, external_order_id,
            payment_evidence_version, decision, observed_status, reason_code, updated_at, provider_observation)
            VALUES (${fulfillmentId}, ${value.orderId}, ${value.purchaseIntentId}, ${value.shop}, ${value.externalOrderId},
              ${paymentVersion}, ${decision.kind}, ${status}, ${decision.reason}, ${now}, ${tx.json(observation)})`;
        }
        const payload = { fulfillmentId, orderId: value.orderId, status, decision: decision.kind, reason: decision.reason, paymentVersion, intakeVersion: version, providerActivity };
        await tx`INSERT INTO bloombox.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, available_at)
          VALUES (${randomUUID()}, 'Fulfillment', ${fulfillmentId}, 'fulfillment.shopify_intake.updated', 1, ${tx.json(payload)}, ${now}, ${now})`;
        await tx`INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'SYSTEM', 'fulfillment.shopify_intake.updated', 'Fulfillment', ${fulfillmentId}, ${tx.json(payload)}, ${now})`;
        return { outcome: "APPLIED", fulfillmentId, status, decision, providerActivity };
      });
    } catch { throw new ShopifyFulfillmentIntakeError(); }
  }
}
