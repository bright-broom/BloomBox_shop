import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { ShopifyAcceptedOrderUnavailableError, type AcceptedShopifyOrder, type ShopifyAcceptedOrderQuery } from "../application/shopify-accepted-order-query";

/** Resolves immutable acceptance, independently of delivery dates, current cart contents and retained PII. */
export class PostgresShopifyAcceptedOrderQuery implements ShopifyAcceptedOrderQuery {
  constructor(private readonly sql: DatabaseClient) {}
  async find(shop: string, externalOrderId: string): Promise<AcceptedShopifyOrder | null> {
    if (typeof shop !== "string" || typeof externalOrderId !== "string"
      || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || shop.length > 255
      || !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(externalOrderId) || externalOrderId.length > 100) throw new ShopifyAcceptedOrderUnavailableError();
    try {
      const rows = await this.sql`SELECT orders.id, orders.display_id, orders.purchase_intent_id, link.attempt_id
        FROM bloombox.shopify_order_acceptances AS receipt
        JOIN bloombox.orders AS orders ON orders.id = receipt.order_id AND orders.purchase_intent_id = receipt.purchase_intent_id
          AND orders.external_order_id = receipt.external_order_id AND orders.commerce_provider = 'SHOPIFY'
        JOIN bloombox.shopify_order_links AS link ON link.purchase_intent_id = receipt.purchase_intent_id
          AND link.provider_scope = receipt.provider_scope AND link.external_order_id = receipt.external_order_id
        WHERE receipt.provider_scope = ${shop} AND receipt.external_order_id = ${externalOrderId}`;
      if (!rows.length) return null;
      const row = z.object({ id: z.uuid(), display_id: z.string(), purchase_intent_id: z.uuid(), attempt_id: z.uuid() }).parse(rows[0]);
      return { orderId: row.id, displayId: row.display_id, purchaseIntentId: row.purchase_intent_id, attemptId: row.attempt_id };
    } catch { throw new ShopifyAcceptedOrderUnavailableError(); }
  }
}
