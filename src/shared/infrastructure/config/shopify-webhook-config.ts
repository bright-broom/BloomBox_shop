import { z } from "zod";
import { SHOPIFY_STOREFRONT_API_VERSION } from "./shopify-storefront-config";

export type ShopifyWebhookConfig = Readonly<{
  storeDomain: string;
  webhookSecret: string;
  apiVersion: typeof SHOPIFY_STOREFRONT_API_VERSION;
}>;
export class InvalidShopifyWebhookConfigurationError extends Error {
  constructor() {
    super("Shopify webhook configuration is invalid");
    this.name = "InvalidShopifyWebhookConfigurationError";
  }
}

/** Capture is opt-in and does not activate payment/order projection or live checkout. */
export function loadShopifyWebhookConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ShopifyWebhookConfig | null {
  const mode = environment.BLOOMBOX_SHOPIFY_WEBHOOK_MODE ?? "disabled";
  if (mode === "disabled") return null;
  if (mode !== "capture") throw new InvalidShopifyWebhookConfigurationError();
  const parsed = z.object({
    SHOPIFY_STORE_DOMAIN: z.string().trim().toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).max(255),
    SHOPIFY_WEBHOOK_SECRET: z.string().min(16).max(256),
  }).safeParse(environment);
  if (!parsed.success) throw new InvalidShopifyWebhookConfigurationError();
  return {
    storeDomain: parsed.data.SHOPIFY_STORE_DOMAIN,
    webhookSecret: parsed.data.SHOPIFY_WEBHOOK_SECRET,
    apiVersion: SHOPIFY_STOREFRONT_API_VERSION,
  };
}
