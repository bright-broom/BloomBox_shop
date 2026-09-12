import { z } from "zod";

const httpsOrigin = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
    && !url.port && url.pathname === "/" && !["localhost", "127.0.0.1"].includes(url.hostname);
}).transform((value) => new URL(value).origin);
const schema = z.object({
  CUSTOMER_ACCOUNT_ORIGIN: httpsOrigin,
  CUSTOMER_ACCOUNT_SECRET: z.string().min(32).max(512),
  CUSTOMER_ACCOUNT_CLIENT_ID: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/),
  CUSTOMER_ACCOUNT_CLIENT_SECRET: z.string().min(16).max(1024),
  CUSTOMER_ACCOUNT_SHOP_ID: z.string().regex(/^[1-9][0-9]{0,19}$/),
  SHOPIFY_STORE_DOMAIN: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
});
export type CustomerAccountConfig = Readonly<{
  origin: string; secret: string; clientId: string; clientSecret: string; shopId: string; storeDomain: string;
}>;
export class InvalidCustomerAccountConfigurationError extends Error {
  constructor() { super("Customer account configuration is invalid"); this.name = "InvalidCustomerAccountConfigurationError"; }
}
export function loadCustomerAccountConfig(env: Readonly<Record<string, string | undefined>> = process.env): CustomerAccountConfig | null {
  if (env.CUSTOMER_ACCOUNT_ENABLED === undefined || env.CUSTOMER_ACCOUNT_ENABLED === "false") return null;
  const parsed = schema.safeParse(env);
  if (env.CUSTOMER_ACCOUNT_ENABLED !== "true" || !parsed.success || env.NEXTAUTH_URL || env.AUTH_REDIRECT_PROXY_URL) {
    throw new InvalidCustomerAccountConfigurationError();
  }
  const data = parsed.data;
  // Auth.js supports one application origin, with separate customer/operator paths and cookies.
  // Server-action helpers otherwise derive callbacks from forwarded headers. Require a pinned origin.
  if (!env.AUTH_URL || env.AUTH_URL.replace(/\/$/, "") !== data.CUSTOMER_ACCOUNT_ORIGIN) throw new InvalidCustomerAccountConfigurationError();
  return { origin: data.CUSTOMER_ACCOUNT_ORIGIN, secret: data.CUSTOMER_ACCOUNT_SECRET,
    clientId: data.CUSTOMER_ACCOUNT_CLIENT_ID, clientSecret: data.CUSTOMER_ACCOUNT_CLIENT_SECRET,
    shopId: data.CUSTOMER_ACCOUNT_SHOP_ID, storeDomain: data.SHOPIFY_STORE_DOMAIN };
}
