import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { FulfillmentOperatorIdentity } from "../application/approve-shopify-fulfillment";
import { FulfillmentReviewError } from "../application/read-fulfillment-review";
import { FULFILLMENT_INBOX_PAGE_SIZE, type FulfillmentInbox, type FulfillmentInboxQuery, type FulfillmentInboxRequest } from "../application/read-fulfillment-inbox";
import { FULFILLMENT_STATUSES } from "../domain/fulfillment-status";

const shopSchema = z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/);
const referenceSchema = z.string().regex(/^gid:\/\/shopify\/Order\/[1-9]\d{0,29}$/);
const cursorSchema = z.object({ shop: shopSchema, testMode: z.boolean(), after: referenceSchema }).strict();
const requestSchema = z.object({ shop: shopSchema, cursor: z.string().min(1).max(600).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict();
const recordSchema = z.object({
  fulfillment_id: z.uuid(), external_order_id: referenceSchema, delivery_date: z.iso.date(), status: z.enum(FULFILLMENT_STATUSES),
  total_minor: z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
});

/** Keyset over the existing (provider_scope, external_order_id) unique index; IDs are immutable. */
export class PostgresFulfillmentInboxQuery implements FulfillmentInboxQuery {
  constructor(private readonly sql: DatabaseClient, private readonly expectedTestMode: boolean,
    private readonly identity: FulfillmentOperatorIdentity = { current: async () => null },
    private readonly now: () => Date = () => new Date()) {}

  async list(input: FulfillmentInboxRequest): Promise<FulfillmentInbox> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new FulfillmentReviewError("INVALID_REQUEST");
    const value = parsed.data;
    let after = "";
    if (value.cursor) {
      try {
        const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value.cursor, "base64url").toString("utf8")));
        if (cursor.shop !== value.shop || cursor.testMode !== this.expectedTestMode) throw new Error("Cursor scope mismatch");
        after = cursor.after;
      } catch { throw new FulfillmentReviewError("INVALID_REQUEST"); }
    }
    try {
      const authenticated = z.object({ operatorId: z.uuid(), expiresAt: z.date() }).safeParse(await this.identity.current());
      if (!authenticated.success) throw new FulfillmentReviewError("NOT_AUTHORIZED");
      const actor = authenticated.data;
      return await this.sql.begin(async (tx) => {
        const [permission] = await tx`SELECT enabled, created_at, valid_until FROM bloombox.fulfillment_operator_permissions
          WHERE operator_id = ${actor.operatorId} AND provider_scope = ${value.shop} FOR SHARE`;
        const authorizedAt = z.date().parse(this.now());
        if (!permission || permission.enabled !== true || z.date().parse(permission.created_at) > authorizedAt
          || z.date().parse(permission.valid_until) <= authorizedAt || actor.expiresAt <= authorizedAt) {
          throw new FulfillmentReviewError("NOT_AUTHORIZED");
        }
        // Every page reauthorizes; the caller's cursor is only a position, never an access capability.
        const raw = await tx`SELECT intake.fulfillment_id, intake.external_order_id, gift.delivery_date::text, orders.total_minor, fulfillment.status
          FROM bloombox.shopify_fulfillment_intakes AS intake
          JOIN bloombox.orders AS orders ON orders.id = intake.order_id AND orders.purchase_intent_id = intake.purchase_intent_id
            AND orders.commerce_provider = 'SHOPIFY' AND orders.external_order_id = intake.external_order_id AND orders.currency = 'JPY'
          JOIN bloombox.fulfillments AS fulfillment ON fulfillment.id = intake.fulfillment_id AND fulfillment.order_id = intake.order_id
          JOIN bloombox.order_gift_snapshots AS gift ON gift.order_id = intake.order_id
          JOIN bloombox.shopify_payment_evidence AS evidence ON evidence.purchase_intent_id = intake.purchase_intent_id
            AND evidence.provider_scope = intake.provider_scope AND evidence.external_order_id = intake.external_order_id
          WHERE intake.provider_scope = ${value.shop} AND intake.external_order_id > ${after}
            AND evidence.snapshot->>'test' = ${String(this.expectedTestMode)}
          ORDER BY intake.external_order_id ASC LIMIT ${FULFILLMENT_INBOX_PAGE_SIZE + 1}`;
        const viewedAt = z.date().parse(this.now());
        if (actor.expiresAt <= viewedAt || z.date().parse(permission.valid_until) <= viewedAt) throw new FulfillmentReviewError("NOT_AUTHORIZED");
        const rows = z.array(recordSchema).max(FULFILLMENT_INBOX_PAGE_SIZE + 1).parse(raw);
        const page = rows.slice(0, FULFILLMENT_INBOX_PAGE_SIZE);
        const last = page.at(-1);
        return {
          shop: value.shop, testMode: this.expectedTestMode, viewedAt: viewedAt.toISOString(),
          entries: page.map((row) => ({ fulfillmentId: row.fulfillment_id, reference: row.external_order_id.slice(row.external_order_id.lastIndexOf("/") + 1),
            deliveryDate: row.delivery_date, totalMinor: row.total_minor, status: row.status })),
          nextCursor: rows.length > FULFILLMENT_INBOX_PAGE_SIZE && last
            ? Buffer.from(JSON.stringify({ shop: value.shop, testMode: this.expectedTestMode, after: last.external_order_id })).toString("base64url") : null,
        };
      });
    } catch (error) {
      if (error instanceof FulfillmentReviewError) throw error;
      throw new FulfillmentReviewError("UNAVAILABLE");
    }
  }
}
