import { z } from "zod";

export const SHOPIFY_STOREFRONT_API_VERSION = "2026-07" as const;
export const SHOPIFY_PRODUCT_IMAGE_HOST = "cdn.shopify.com" as const;

const environmentSchema = z.object({
  SHOPIFY_STORE_DOMAIN: z.string().trim().toLowerCase(),
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: z.string().min(16).max(256),
  SHOPIFY_CATALOG_TAG: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).default("bloombox"),
});

export type ShopifyStorefrontConfig = Readonly<{
  storeDomain: string;
  accessToken: string;
  catalogTag: string;
  apiVersion: typeof SHOPIFY_STOREFRONT_API_VERSION;
}>;

export class InvalidShopifyStorefrontConfigurationError extends Error {
  constructor() {
    super("Shopify Storefront configuration is invalid");
    this.name = "InvalidShopifyStorefrontConfigurationError";
  }
}

export function loadShopifyStorefrontConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ShopifyStorefrontConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (
    !parsed.success
    || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(parsed.data.SHOPIFY_STORE_DOMAIN)
  ) {
    throw new InvalidShopifyStorefrontConfigurationError();
  }
  return {
    storeDomain: parsed.data.SHOPIFY_STORE_DOMAIN,
    accessToken: parsed.data.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    catalogTag: parsed.data.SHOPIFY_CATALOG_TAG,
    apiVersion: SHOPIFY_STOREFRONT_API_VERSION,
  };
}
