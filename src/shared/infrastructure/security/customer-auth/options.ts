import { customFetch, type NextAuthConfig } from "next-auth";
import { z } from "zod";
import type { CustomerAccountConfig } from "../../config/customer-account-config";
import { createCustomerTokenFetch, customerEndpoints } from "./provider";

export const CUSTOMER_AUTH_PATH = "/api/customer-auth";
export const CUSTOMER_SESSION_COOKIE = "__Host-bloombox.customer-session";
export const CUSTOMER_SESSION_SECONDS = 15 * 60;
export const customerSessionSchema = z.object({
  subject: z.string().min(1).max(255), shopId: z.string(), clientId: z.string(),
  accessToken: z.string().min(1).max(8192), expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export function createCustomerAuthOptions(config: CustomerAccountConfig, now: () => number = Date.now): NextAuthConfig {
  const endpoints = customerEndpoints(config);
  const profileSchema = z.object({ sub: z.string().min(1).max(255), iss: z.literal(endpoints.issuer) });
  const cookie = (name: string) => ({ name: `__Host-bloombox.customer-${name}`,
    options: { httpOnly: true, sameSite: "lax" as const, secure: true, path: "/" } });
  return {
    basePath: CUSTOMER_AUTH_PATH, secret: config.secret, trustHost: true, useSecureCookies: true,
    cookies: { sessionToken: cookie("session"), csrfToken: cookie("csrf"), callbackUrl: cookie("callback"),
      pkceCodeVerifier: cookie("pkce"), state: cookie("state"), nonce: cookie("nonce") },
    providers: [{ id: "shopify-customer", name: "Shopify", type: "oidc", issuer: endpoints.issuer,
      wellKnown: endpoints.discovery, clientId: config.clientId, clientSecret: config.clientSecret,
      // Shopify has no userinfo endpoint. Use verified ID-token claims; pin token URL to the discovered shop.
      token: endpoints.token, idToken: true,
      checks: ["pkce", "state", "nonce"], client: { token_endpoint_auth_method: "client_secret_basic" },
      authorization: { params: { scope: "openid email customer-account-api:full", locale: "ja", region_country: "JP" } },
      [customFetch]: createCustomerTokenFetch(config),
      profile(value) { return { id: profileSchema.parse(value).sub }; } }],
    session: { strategy: "jwt", maxAge: CUSTOMER_SESSION_SECONDS }, jwt: { maxAge: CUSTOMER_SESSION_SECONDS },
    pages: { signIn: "/account", error: "/account" },
    callbacks: {
      async signIn({ account, profile }) {
        const parsed = profileSchema.safeParse(profile);
        return account?.provider === "shopify-customer" && parsed.success && account.providerAccountId === parsed.data.sub;
      },
      async jwt({ token, account, profile }) {
        if (account) {
          const parsed = profileSchema.safeParse(profile);
          if (!parsed.success || account.provider !== "shopify-customer" || account.providerAccountId !== parsed.data.sub
            || !account.expires_at || (account.scope !== undefined && !account.scope.split(" ").includes("customer-account-api:full"))) return null;
          const value = customerSessionSchema.safeParse({ subject: parsed.data.sub, shopId: config.shopId, clientId: config.clientId,
            accessToken: account.access_token, expiresAt: Math.min(account.expires_at * 1000, now() + CUSTOMER_SESSION_SECONDS * 1000) });
          return value.success && value.data.expiresAt > now() ? value.data : null;
        }
        // Never accept identity, token, expiry or profile values from a client session update.
        const value = customerSessionSchema.safeParse(token);
        return value.success && value.data.shopId === config.shopId && value.data.clientId === config.clientId
          && value.data.expiresAt > now() && value.data.expiresAt <= now() + CUSTOMER_SESSION_SECONDS * 1000 ? value.data : null;
      },
      async session({ token }) {
        const value = customerSessionSchema.parse(token);
        return { user: { id: value.subject }, expires: new Date(value.expiresAt).toISOString() };
      },
      async redirect() { return `${config.origin}/account`; },
    },
    logger: { error() { console.error("customer_auth_error"); }, warn() { console.warn("customer_auth_warning"); }, debug() {} }, debug: false,
  };
}
