import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ShopifyWebhookConfig } from "@/shared/infrastructure/config/shopify-webhook-config";
import {
  InvalidProviderWebhookError,
  type ProviderWebhookVerifier,
  type VerifiedProviderEvent,
} from "../application/receive-provider-webhook";

const MAX_BODY_BYTES = 1_000_000;
export type ShopifyWebhookHeaders = Readonly<{
  signature: string | null;
  shop: string | null;
  topic: string | null;
  apiVersion: string | null;
}>;
const orderTopics = new Set([
  "orders/create", "orders/updated", "orders/paid", "orders/cancelled",
  "orders/fulfilled", "orders/partially_fulfilled",
]);
const timestampSchema = z.iso.datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)));
const orderSchema = z.object({
  admin_graphql_api_id: z.string().regex(/^gid:\/\/shopify\/Order\/[1-9]\d*$/).max(100),
  updated_at: timestampSchema,
});
const refundSchema = z.object({
  admin_graphql_api_id: z.string().regex(/^gid:\/\/shopify\/Refund\/[1-9]\d*$/).max(100),
  created_at: timestampSchema,
});

/** Signature-verified references only. Header hints and payload facts do not authorize payment transitions. */
export class ShopifyWebhookVerifier implements ProviderWebhookVerifier<Uint8Array, ShopifyWebhookHeaders> {
  constructor(private readonly config: ShopifyWebhookConfig) {}

  verify(rawBody: Uint8Array, headers: ShopifyWebhookHeaders): VerifiedProviderEvent | null {
    try {
      if (rawBody.byteLength > MAX_BODY_BYTES || !headers.signature
        || !/^[A-Za-z0-9+/]{43}=$/.test(headers.signature)) {
        throw new InvalidProviderWebhookError();
      }
      const signature = Buffer.from(headers.signature, "base64");
      const expected = createHmac("sha256", this.config.webhookSecret).update(rawBody).digest();
      if (signature.toString("base64") !== headers.signature || !timingSafeEqual(signature, expected)) {
        throw new InvalidProviderWebhookError();
      }
      if (headers.shop !== this.config.storeDomain
        || headers.apiVersion !== this.config.apiVersion || !headers.topic) {
        throw new InvalidProviderWebhookError();
      }
      const isOrder = orderTopics.has(headers.topic);
      if (!isOrder && headers.topic !== "refunds/create") return null;
      const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBody));
      const reference = isOrder ? orderSchema.parse(body) : refundSchema.parse(body);
      const occurredAt = "updated_at" in reference ? reference.updated_at : reference.created_at;
      // Unsigned event/delivery headers must not let a replay invent a fresh inbox identity.
      const digest = createHash("sha256").update(rawBody).digest("hex");
      return {
        provider: "SHOPIFY",
        providerAccountId: this.config.storeDomain,
        externalEventId: `body-sha256:${digest}`,
        eventType: isOrder ? "shopify.order.changed" : "shopify.refund.changed",
        externalObjectId: reference.admin_graphql_api_id,
        apiVersion: this.config.apiVersion,
        occurredAt: new Date(occurredAt),
        payload: {
          objectType: isOrder ? "shopify_order_reference" : "shopify_refund_reference",
          id: reference.admin_graphql_api_id,
          sourceOccurredAt: occurredAt,
        },
      };
    } catch {
      throw new InvalidProviderWebhookError();
    }
  }
}
