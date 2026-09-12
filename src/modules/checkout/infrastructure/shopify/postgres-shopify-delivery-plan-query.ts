import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { ShopifyOrderLink } from "../../application/link-shopify-order";
import { ShopifyDeliveryPlanUnavailableError, type ShopifyDeliveryPlan, type ShopifyDeliveryPlanQuery } from "../../application/shopify-delivery-plan-query";

const inputSchema = z.object({
  purchaseIntentId: z.uuid(), attemptId: z.uuid(),
  orderId: z.string().max(100).regex(/^gid:\/\/shopify\/Order\/[1-9]\d*$/),
  shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
});
const rowSchema = z.object({
  delivery_date: z.iso.date(), status: z.enum(["CHECKOUT_CREATED", "CONVERTED", "EXPIRED", "ABANDONED"]),
  details_available: z.boolean(), pii_retention_expires_at: z.date(),
});

/** Checkout reads its own tables; no decryption, contact fields, mutations or caller-provided delivery dates. */
export class PostgresShopifyDeliveryPlanQuery implements ShopifyDeliveryPlanQuery {
  constructor(private readonly sql: DatabaseClient) {}
  async find(link: ShopifyOrderLink, shop: string): Promise<ShopifyDeliveryPlan | null> {
    const parsed = inputSchema.safeParse({ ...link, shop });
    if (!parsed.success) return null;
    const input = parsed.data;
    try {
      const rows = await this.sql`SELECT intent.delivery_date::text AS delivery_date, intent.status,
          (intent.pii_purged_at IS NULL AND intent.pii_key_id IS NOT NULL
            AND intent.recipient_ciphertext IS NOT NULL AND intent.gift_message_ciphertext IS NOT NULL) AS details_available,
          intent.pii_retention_expires_at
        FROM bloombox.purchase_intents AS intent
        JOIN bloombox.shopify_order_links AS link ON link.purchase_intent_id = intent.id
        WHERE intent.id = ${input.purchaseIntentId} AND intent.commerce_provider = 'SHOPIFY'
          AND link.attempt_id = ${input.attemptId} AND link.provider_scope = ${input.shop}
          AND link.external_order_id = ${input.orderId}`;
      if (rows.length === 0) return null;
      if (rows.length !== 1) throw new ShopifyDeliveryPlanUnavailableError();
      const row = rowSchema.parse(rows[0]);
      return { deliveryDate: row.delivery_date, status: row.status,
        detailsAvailable: row.details_available, retentionExpiresAt: row.pii_retention_expires_at };
    } catch {
      throw new ShopifyDeliveryPlanUnavailableError();
    }
  }
}
