import { customFetch, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { z } from "zod";
import type { CustomerIdentityRepository } from "@/modules/customer/public";
import type { CustomerAccountConfig } from "../../config/customer-account-config";
import { createGoogleTokenFetch } from "../google-auth-fetch";

export const CUSTOMER_AUTH_PATH = "/api/customer-auth";
export const CUSTOMER_SESSION_COOKIE = "__Host-bloombox.google-customer-session";
export const CUSTOMER_SESSION_SECONDS = 15 * 60;
export function customerSessionCookie(config: CustomerAccountConfig) {
  return config.origin.startsWith("https:") ? CUSTOMER_SESSION_COOKIE : CUSTOMER_SESSION_COOKIE.replace("__Host-", "");
}
const subject = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);
const profileSchema = z.object({ sub: subject, iss: z.literal("https://accounts.google.com"),
  email: z.email().max(254), email_verified: z.literal(true), name: z.string().max(200).optional() });
export const customerSessionSchema = z.object({
  kind: z.literal("google-customer"), subject, customerId: z.uuid(), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  clientId: z.string(), origin: z.string(), email: z.email().max(254), name: z.string().max(200),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export function createCustomerAuthOptions(config: CustomerAccountConfig, identities: CustomerIdentityRepository, now: () => number = Date.now): NextAuthConfig {
  const secure = config.origin.startsWith("https:");
  const cookie = (name: string) => ({ name: `${secure ? "__Host-" : ""}bloombox.google-customer-${name}`,
    options: { httpOnly: true, sameSite: "lax" as const, secure, path: "/" } });
  return {
    basePath: CUSTOMER_AUTH_PATH, secret: config.secret, trustHost: true, useSecureCookies: secure,
    cookies: { sessionToken: cookie("session"), csrfToken: cookie("csrf"), callbackUrl: cookie("callback"),
      pkceCodeVerifier: cookie("pkce"), state: cookie("state"), nonce: cookie("nonce") },
    providers: [Google({ clientId: config.clientId, clientSecret: config.clientSecret,
      [customFetch]: createGoogleTokenFetch(config.clientId), checks: ["pkce", "state", "nonce"],
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } } })],
    session: { strategy: "jwt", maxAge: CUSTOMER_SESSION_SECONDS }, jwt: { maxAge: CUSTOMER_SESSION_SECONDS },
    pages: { signIn: "/account", error: "/account" },
    callbacks: {
      async signIn({ account, profile }) {
        const parsed = profileSchema.safeParse(profile);
        return account?.provider === "google" && parsed.success && account.providerAccountId === parsed.data.sub;
      },
      async jwt({ token, account, profile }) {
        if (account) {
          const parsed = profileSchema.safeParse(profile);
          if (!parsed.success || account.provider !== "google" || account.providerAccountId !== parsed.data.sub) return null;
          const identity = await identities.registerGoogleSubject(parsed.data.sub);
          // Persist no Google token. Identity is the verified subject, never an email match.
          return customerSessionSchema.parse({ kind: "google-customer", subject: parsed.data.sub, ...identity,
            clientId: config.clientId, origin: config.origin, email: parsed.data.email, name: parsed.data.name ?? "",
            expiresAt: now() + CUSTOMER_SESSION_SECONDS * 1000 });
        }
        // Ignore client updates and never extend the absolute login lifetime.
        const value = customerSessionSchema.safeParse(token);
        return value.success && value.data.clientId === config.clientId && value.data.origin === config.origin
          && value.data.expiresAt > now() && value.data.expiresAt <= now() + CUSTOMER_SESSION_SECONDS * 1000
          && await identities.isActive(value.data.subject, value.data) ? value.data : null;
      },
      async session({ token }) {
        const value = customerSessionSchema.parse(token);
        return { user: { id: value.customerId }, expires: new Date(value.expiresAt).toISOString() };
      },
      async redirect() { return `${config.origin}/account`; },
    },
    logger: { error() { console.error("customer_auth_error"); }, warn() { console.warn("customer_auth_warning"); }, debug() {} }, debug: false,
  };
}
