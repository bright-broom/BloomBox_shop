import { z } from "zod";
import { loadShopifyAdminConfig, type ShopifyAdminConfig } from "./shopify-admin-config";

export type ShopifyInboxConfig = Readonly<{ admin: ShopifyAdminConfig; workerSecret: string }>;
export class InvalidShopifyInboxConfigurationError extends Error {
  constructor() { super("Shopify inbox configuration is invalid"); this.name = "InvalidShopifyInboxConfigurationError"; }
}

/** Durable adapters are required, but only Shopify test orders are allowed. No live mode exists. */
export function loadShopifyInboxConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ShopifyInboxConfig | null {
  if ((environment.BLOOMBOX_SHOPIFY_INBOX_MODE ?? "disabled") === "disabled") return null;
  const parsed = z.object({
    BLOOMBOX_SHOPIFY_INBOX_MODE: z.literal("test"),
    BLOOMBOX_RUNTIME_MODE: z.literal("production"),
    SHOPIFY_INBOX_WORKER_SECRET: z.string().min(32).max(256).regex(/^\S+$/),
  }).safeParse(environment);
  if (!parsed.success) throw new InvalidShopifyInboxConfigurationError();
  const admin = loadShopifyAdminConfig(environment);
  if (!admin) throw new InvalidShopifyInboxConfigurationError();
  return { admin, workerSecret: parsed.data.SHOPIFY_INBOX_WORKER_SECRET };
}
