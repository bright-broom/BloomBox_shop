import { z } from "zod";
const secret = z.string().min(16).max(4096);
const digits = z.string().regex(/^\d{1,30}$/);
const schema = z.object({
  BLOOMBOX_ADVERTISING_ENABLED: z.enum(["true", "false"]).default("false"),
  BLOOMBOX_RUNTIME_MODE: z.enum(["preview", "production"]).default("preview"),
  BLOOMBOX_PUBLIC_ORIGIN: z.url().optional(),
  AD_GOOGLE_CUSTOMER_ID: z.string().regex(/^\d{10}$/).optional(),
  AD_GOOGLE_CONVERSION_ACTION_ID: digits.optional(),
  AD_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  AD_GOOGLE_CLIENT_SECRET: secret.optional(),
  AD_GOOGLE_REFRESH_TOKEN: secret.optional(),
  AD_META_PIXEL_ID: digits.optional(),
  AD_META_ACCESS_TOKEN: secret.optional(),
  AD_META_API_VERSION: z.string().regex(/^v\d+\.0$/).optional(),
  AD_WEBHOOK_URL: z.url().optional(),
  AD_WEBHOOK_SECRET: z.string().min(32).max(256).optional(),
});
export type AdvertisingConfig = Readonly<{
  enabled: boolean; live: boolean; origin: string;
  google?: { customerId: string; conversionActionId: string; clientId: string; clientSecret: string; refreshToken: string };
  meta?: { pixelId: string; accessToken: string; apiVersion: string };
  webhook?: { url: string; secret: string };
}>;
export class InvalidAdvertisingConfigurationError extends Error {
  constructor() { super("Advertising configuration is invalid"); this.name = "InvalidAdvertisingConfigurationError"; }
}
export function loadAdvertisingConfig(env: Readonly<Record<string, string | undefined>> = process.env): AdvertisingConfig {
  if (env.BLOOMBOX_ADVERTISING_ENABLED === undefined || env.BLOOMBOX_ADVERTISING_ENABLED === "false") {
    return { enabled: false, live: false, origin: "" };
  }
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new InvalidAdvertisingConfigurationError();
  const v = parsed.data;
  if (!v.BLOOMBOX_PUBLIC_ORIGIN) throw new InvalidAdvertisingConfigurationError();
  const url = new URL(v.BLOOMBOX_PUBLIC_ORIGIN);
  const local = v.BLOOMBOX_RUNTIME_MODE === "preview" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new InvalidAdvertisingConfigurationError();
  const google = [v.AD_GOOGLE_CUSTOMER_ID, v.AD_GOOGLE_CONVERSION_ACTION_ID, v.AD_GOOGLE_CLIENT_ID, v.AD_GOOGLE_CLIENT_SECRET, v.AD_GOOGLE_REFRESH_TOKEN];
  const meta = [v.AD_META_PIXEL_ID, v.AD_META_ACCESS_TOKEN, v.AD_META_API_VERSION];
  const webhook = [v.AD_WEBHOOK_URL, v.AD_WEBHOOK_SECRET];
  if ([google, meta, webhook].some((group) => group.some(Boolean) && !group.every(Boolean))) throw new InvalidAdvertisingConfigurationError();
  if (v.AD_WEBHOOK_URL) {
    const target = new URL(v.AD_WEBHOOK_URL);
    if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash) throw new InvalidAdvertisingConfigurationError();
  }
  if (v.BLOOMBOX_RUNTIME_MODE === "production" && ![google, meta, webhook].some((group) => group.every(Boolean))) throw new InvalidAdvertisingConfigurationError();
  return {
    enabled: true, live: v.BLOOMBOX_RUNTIME_MODE === "production", origin: url.origin,
    google: v.AD_GOOGLE_CUSTOMER_ID && v.AD_GOOGLE_CONVERSION_ACTION_ID && v.AD_GOOGLE_CLIENT_ID && v.AD_GOOGLE_CLIENT_SECRET && v.AD_GOOGLE_REFRESH_TOKEN
      ? { customerId: v.AD_GOOGLE_CUSTOMER_ID, conversionActionId: v.AD_GOOGLE_CONVERSION_ACTION_ID, clientId: v.AD_GOOGLE_CLIENT_ID, clientSecret: v.AD_GOOGLE_CLIENT_SECRET, refreshToken: v.AD_GOOGLE_REFRESH_TOKEN } : undefined,
    meta: v.AD_META_PIXEL_ID && v.AD_META_ACCESS_TOKEN && v.AD_META_API_VERSION
      ? { pixelId: v.AD_META_PIXEL_ID, accessToken: v.AD_META_ACCESS_TOKEN, apiVersion: v.AD_META_API_VERSION } : undefined,
    webhook: v.AD_WEBHOOK_URL && v.AD_WEBHOOK_SECRET ? { url: v.AD_WEBHOOK_URL, secret: v.AD_WEBHOOK_SECRET } : undefined,
  };
}
