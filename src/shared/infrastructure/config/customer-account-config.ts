import { z } from "zod";

const origin = z.url().refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash && url.pathname === "/"
    && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
}).transform((value) => new URL(value).origin);
const schema = z.object({
  CUSTOMER_ACCOUNT_ORIGIN: origin,
  CUSTOMER_ACCOUNT_SECRET: z.string().min(32).max(512),
  CUSTOMER_GOOGLE_CLIENT_ID: z.string().regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/),
  CUSTOMER_GOOGLE_CLIENT_SECRET: z.string().min(16).max(1024),
});
export type CustomerAccountConfig = Readonly<{
  origin: string; secret: string; clientId: string; clientSecret: string;
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
  if (!env.AUTH_URL || env.AUTH_URL.replace(/\/$/, "") !== data.CUSTOMER_ACCOUNT_ORIGIN
    || data.CUSTOMER_ACCOUNT_SECRET === env.AUTH_SECRET || data.CUSTOMER_GOOGLE_CLIENT_ID === env.AUTH_GOOGLE_ID
    || (env.BLOOMBOX_RUNTIME_MODE === "production" && !data.CUSTOMER_ACCOUNT_ORIGIN.startsWith("https:"))) {
    throw new InvalidCustomerAccountConfigurationError();
  }
  return { origin: data.CUSTOMER_ACCOUNT_ORIGIN, secret: data.CUSTOMER_ACCOUNT_SECRET,
    clientId: data.CUSTOMER_GOOGLE_CLIENT_ID, clientSecret: data.CUSTOMER_GOOGLE_CLIENT_SECRET };
}
