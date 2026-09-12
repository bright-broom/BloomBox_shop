import NextAuth from "next-auth";
import { getToken } from "next-auth/jwt";
import type { CustomerIdentityRepository } from "@/modules/customer/public";
import { PostgresCustomerIdentityRepository } from "@/modules/customer/infrastructure/postgres-customer-identity-repository";
import { getApplicationDatabaseClient } from "../../database/database-connections";
import { loadCustomerAccountConfig, type CustomerAccountConfig } from "../../config/customer-account-config";
import { createCustomerAuthOptions, customerSessionCookie, CUSTOMER_SESSION_SECONDS, customerSessionSchema } from "./options";

export function getCustomerIdentityRepository(): CustomerIdentityRepository {
  return new PostgresCustomerIdentityRepository(getApplicationDatabaseClient());
}
export function getCustomerAuth() {
  const config = loadCustomerAccountConfig();
  return config ? { config, auth: NextAuth(createCustomerAuthOptions(config, getCustomerIdentityRepository())) } : null;
}
export function isCustomerOrigin(request: Request, config: CustomerAccountConfig) {
  return new URL(request.url).origin === config.origin
    && (request.method === "GET" || request.headers.get("origin") === config.origin);
}
/** Decrypt the customer-only cookie and recheck account status/version on every private read. */
export async function readCustomerCredential(cookie: string, config: CustomerAccountConfig, now = Date.now(), identities = getCustomerIdentityRepository()) {
  if (cookie.length > 32_768) return null;
  const token = await getToken({ req: { headers: new Headers({ cookie }) },
    cookieName: customerSessionCookie(config), secret: config.secret, secureCookie: config.origin.startsWith("https:"),
    logger: { error() { console.error("customer_session_error"); }, warn() {}, debug() {} } });
  const value = customerSessionSchema.safeParse(token);
  return value.success && value.data.clientId === config.clientId && value.data.origin === config.origin
    && value.data.expiresAt > now && value.data.expiresAt <= now + CUSTOMER_SESSION_SECONDS * 1000
    && await identities.isActive(value.data.subject, value.data) ? value.data : null;
}
