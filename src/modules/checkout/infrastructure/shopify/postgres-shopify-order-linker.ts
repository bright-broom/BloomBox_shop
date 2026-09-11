import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import {
  ShopifyOrderLinkPersistenceError, ShopifyOrderLinkUnresolvedError,
  type ShopifyOrderLinker, type ShopifyOrderLinkInput, type ShopifyOrderLink,
} from "../../application/link-shopify-order";
import { shopifyCartTokenDigest } from "./shopify-cart-identity";

const inputSchema = z.object({
  shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  orderId: z.string().max(100).regex(/^gid:\/\/shopify\/Order\/[1-9]\d*$/),
  apiVersion: z.string().regex(/^\d{4}-\d{2}$/),
  cartToken: z.string().min(1).max(128_000).refine((value) => Buffer.byteLength(value, "utf8") <= 128_000),
  lines: z.array(z.object({
    variantId: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/).max(100),
    quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    originalUnitPrice: z.object({ currency: z.literal("JPY"), amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
  })).length(1),
});

/** Checkout owns this immutable association; no Payment/Order/Fulfillment tables are mutated. */
export class PostgresShopifyOrderLinker implements ShopifyOrderLinker {
  constructor(private readonly sql: DatabaseClient, private readonly now: () => Date = () => new Date()) {}

  async link(input: ShopifyOrderLinkInput): Promise<ShopifyOrderLink> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new ShopifyOrderLinkUnresolvedError();
    const value = parsed.data;
    const digest = shopifyCartTokenDigest(value.cartToken);
    try {
      return await this.sql.begin(async (tx) => {
        const candidates = await tx`SELECT purchase_intent_id FROM bloombox.shopify_checkout_attempts
          WHERE provider_scope = ${value.shop} AND cart_token_digest = ${digest}`;
        if (candidates.length !== 1) throw new ShopifyOrderLinkUnresolvedError();
        const id = z.uuid().parse(candidates[0].purchase_intent_id);
        // Completion and association share this parent lock; the worker needs no credential write privilege.
        const intents = await tx`SELECT status, commerce_provider FROM bloombox.purchase_intents WHERE id = ${id} FOR UPDATE`;
        const attempts = await tx`SELECT attempt_id, status, provider_scope, cart_token_digest, api_version
          FROM bloombox.shopify_checkout_attempts WHERE purchase_intent_id = ${id}`;
        const attempt = attempts[0];
        if (intents[0]?.commerce_provider !== "SHOPIFY"
          || !["CHECKOUT_CREATED", "CONVERTED"].includes(intents[0]?.status)
          || !attempt || attempt.status !== "READY" || attempt.provider_scope !== value.shop
          || attempt.cart_token_digest !== digest || attempt.api_version !== value.apiVersion) {
          throw new ShopifyOrderLinkUnresolvedError();
        }
        const items = await tx`SELECT external_product_id, quantity, unit_amount_minor, currency
          FROM bloombox.purchase_intent_items WHERE purchase_intent_id = ${id}`;
        const line = value.lines[0];
        if (items.length !== 1 || items[0].external_product_id !== line.variantId
          || items[0].quantity !== line.quantity || items[0].currency !== line.originalUnitPrice.currency
          || String(items[0].unit_amount_minor) !== String(line.originalUnitPrice.amount)) throw new ShopifyOrderLinkUnresolvedError();
        const existing = await tx`SELECT external_order_id FROM bloombox.shopify_order_links WHERE purchase_intent_id = ${id}`;
        const result = { purchaseIntentId: id, attemptId: z.uuid().parse(attempt.attempt_id), orderId: value.orderId };
        if (existing.length) {
          if (existing[0].external_order_id !== value.orderId) throw new ShopifyOrderLinkUnresolvedError();
          return result;
        }
        const now = this.now();
        await tx`INSERT INTO bloombox.shopify_order_links
          (purchase_intent_id, attempt_id, provider_scope, external_order_id, provider_api_version, linked_at)
          VALUES (${id}, ${result.attemptId}, ${value.shop}, ${value.orderId}, ${value.apiVersion}, ${now})`;
        const metadata = { ...result, provider: "SHOPIFY" };
        await tx`INSERT INTO bloombox.outbox_events
          (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, available_at)
          VALUES (${randomUUID()}, 'PurchaseIntent', ${id}, 'checkout.shopify_order.linked', 1, ${tx.json(metadata)}, ${now}, ${now})`;
        await tx`INSERT INTO bloombox.audit_logs
          (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'SYSTEM', 'checkout.shopify_order.linked', 'PurchaseIntent', ${id}, ${tx.json(metadata)}, ${now})`;
        return result;
      });
    } catch (error) {
      if (error instanceof ShopifyOrderLinkUnresolvedError) throw error;
      if (error instanceof Error && "code" in error && error.code === "23505") throw new ShopifyOrderLinkUnresolvedError();
      throw new ShopifyOrderLinkPersistenceError();
    }
  }
}
