import NextAuth from "next-auth";
import { getToken } from "next-auth/jwt";
import { loadCustomerAccountConfig, type CustomerAccountConfig } from "../../config/customer-account-config";
import { createCustomerAuthOptions, CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_SECONDS, customerSessionSchema } from "./options";

export function getCustomerAuth() {
  const config = loadCustomerAccountConfig();
  return config ? { config, auth: NextAuth(createCustomerAuthOptions(config)) } : null;
}
export function isCustomerOrigin(request: Request, config: CustomerAccountConfig) {
  return new URL(request.url).origin === config.origin
    && (request.method === "GET" || request.headers.get("origin") === config.origin);
}
/** getToken is isolated here because auth().session must never expose the provider access token. */
export async function readCustomerCredential(cookie: string, config: CustomerAccountConfig, now = Date.now()) {
  if (cookie.length > 32_768) return null;
  const token = await getToken({ req: { headers: new Headers({ cookie }) },
    cookieName: CUSTOMER_SESSION_COOKIE, secret: config.secret, secureCookie: true,
    logger: { error() { console.error("customer_session_error"); }, warn() {}, debug() {} } });
  const value = customerSessionSchema.safeParse(token);
  return value.success && value.data.shopId === config.shopId && value.data.clientId === config.clientId
    && value.data.expiresAt > now && value.data.expiresAt <= now + CUSTOMER_SESSION_SECONDS * 1000 ? value.data : null;
}
