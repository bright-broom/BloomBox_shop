import { z } from "zod";
import { loadShopifyStorefrontConfig, type ShopifyStorefrontConfig } from "./shopify-storefront-config";

export type ShopifyCheckoutConfig = ShopifyStorefrontConfig & Readonly<{
  allowedCheckoutHostnames: readonly string[];
}>;

export class InvalidShopifyCheckoutConfigurationError extends Error {
  constructor() {
    super("Shopify checkout configuration is invalid");
    this.name = "InvalidShopifyCheckoutConfigurationError";
  }
}

// Include a verified custom checkout domain explicitly; never allow *.shopify.com.
const hostnameSchema = z.string().trim().toLowerCase().regex(
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
);

export function loadShopifyCheckoutConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ShopifyCheckoutConfig {
  const storefront = loadShopifyStorefrontConfig(environment);
  const parsed = z.array(hostnameSchema).min(1).max(5).safeParse(
    (environment.SHOPIFY_CHECKOUT_HOSTNAMES ?? storefront.storeDomain).split(","),
  );
  if (!parsed.success) throw new InvalidShopifyCheckoutConfigurationError();
  return { ...storefront, allowedCheckoutHostnames: [...new Set(parsed.data)] };
}
