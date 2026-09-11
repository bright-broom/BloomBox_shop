import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { assertPurchaseIntentTransition, PURCHASE_INTENT_STATUSES } from "../../domain/purchase-intent-status";
import { ShopifyPurchaseConversionError, type ShopifyPurchaseConversion, type ShopifyPurchaseConverter } from "../../application/convert-shopify-purchase";

export class PostgresShopifyPurchaseConverter implements ShopifyPurchaseConverter {
  constructor(private readonly sql: DatabaseClient, private readonly now: () => Date = () => new Date()) {}
  async convert(input: ShopifyPurchaseConversion): Promise<{ outcome: "CONVERTED" | "DUPLICATE" }> {
    try {
      const value = z.object({ shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
        externalOrderId: z.string().max(100).regex(/^gid:\/\/shopify\/Order\/[1-9]\d*$/),
        orderId: z.uuid(), purchaseIntentId: z.uuid(), attemptId: z.uuid() }).parse(input);
      return await this.sql.begin(async (tx) => {
        const [intent] = await tx`SELECT status, commerce_provider FROM bloombox.purchase_intents WHERE id = ${value.purchaseIntentId} FOR UPDATE`;
        if (!intent || intent.commerce_provider !== "SHOPIFY") throw new ShopifyPurchaseConversionError();
        const rows = await tx`SELECT receipt.order_id FROM bloombox.shopify_order_acceptances AS receipt
          JOIN bloombox.shopify_order_links AS link ON link.purchase_intent_id = receipt.purchase_intent_id
          JOIN bloombox.orders AS orders ON orders.id = receipt.order_id AND orders.purchase_intent_id = receipt.purchase_intent_id
            AND orders.commerce_provider = 'SHOPIFY' AND orders.external_order_id = receipt.external_order_id
          JOIN bloombox.shopify_payment_projections AS projection ON projection.order_id = receipt.order_id
            AND projection.purchase_intent_id = receipt.purchase_intent_id AND projection.provider_scope = receipt.provider_scope
            AND projection.external_order_id = receipt.external_order_id AND projection.evidence_version >= receipt.payment_evidence_version
          WHERE receipt.order_id = ${value.orderId} AND receipt.purchase_intent_id = ${value.purchaseIntentId}
            AND receipt.provider_scope = ${value.shop} AND receipt.external_order_id = ${value.externalOrderId} AND link.attempt_id = ${value.attemptId}`;
        if (rows.length !== 1) throw new ShopifyPurchaseConversionError();
        const status = z.enum(PURCHASE_INTENT_STATUSES).parse(intent.status);
        if (status === "CONVERTED") return { outcome: "DUPLICATE" };
        assertPurchaseIntentTransition(status, "CONVERTED");
        const now = this.now();
        await tx`UPDATE bloombox.purchase_intents SET status = 'CONVERTED', version = version + 1, updated_at = ${now} WHERE id = ${value.purchaseIntentId}`;
        const payload = { purchaseIntentId: value.purchaseIntentId, orderId: value.orderId, provider: "SHOPIFY" };
        await tx`INSERT INTO bloombox.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, available_at)
          VALUES (${randomUUID()}, 'PurchaseIntent', ${value.purchaseIntentId}, 'checkout.shopify_purchase.converted', 1, ${tx.json(payload)}, ${now}, ${now})`;
        await tx`INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'SYSTEM', 'checkout.shopify_purchase.converted', 'PurchaseIntent', ${value.purchaseIntentId}, ${tx.json(payload)}, ${now})`;
        return { outcome: "CONVERTED" };
      });
    } catch { throw new ShopifyPurchaseConversionError(); }
  }
}
