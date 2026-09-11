import { z } from "zod";

export const SHOPIFY_ADMIN_API_VERSION = "2026-07" as const;
export type ShopifyAdminConfig = Readonly<{
  storeDomain: string;
  accessToken: string;
  apiVersion: typeof SHOPIFY_ADMIN_API_VERSION;
}>;
export class InvalidShopifyAdminConfigurationError extends Error {
  constructor() { super("Shopify Admin configuration is invalid"); this.name = "InvalidShopifyAdminConfigurationError"; }
}

/** Enables read-only integration checks, never live order/payment projection. */
export function loadShopifyAdminConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ShopifyAdminConfig | null {
  const mode = environment.BLOOMBOX_SHOPIFY_ADMIN_MODE ?? "disabled";
  if (mode === "disabled") return null;
  if (mode !== "read") throw new InvalidShopifyAdminConfigurationError();
  const parsed = z.object({
    SHOPIFY_STORE_DOMAIN: z.string().trim().toLowerCase().max(255)
      .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
    SHOPIFY_ADMIN_ACCESS_TOKEN: z.string().min(16).max(512).regex(/^\S+$/),
  }).safeParse(environment);
  if (!parsed.success) throw new InvalidShopifyAdminConfigurationError();
  return { storeDomain: parsed.data.SHOPIFY_STORE_DOMAIN, accessToken: parsed.data.SHOPIFY_ADMIN_ACCESS_TOKEN,
    apiVersion: SHOPIFY_ADMIN_API_VERSION };
}
