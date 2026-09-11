import { customFetch, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { z } from "zod";
import type { OperatorAuthConfig } from "../../config/operator-auth-config";
import { createGoogleTokenFetch } from "./google-fetch";

export const OPERATOR_SESSION_SECONDS = 15 * 60;
export const OPERATOR_AUTH_PATH = "/api/operator-auth";
const profileSchema = z.object({ sub: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/), email: z.email(), email_verified: z.literal(true),
  iss: z.literal("https://accounts.google.com") });
const tokenSchema = z.object({ googleSubject: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/), operatorEmail: z.email(),
  loginExpiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });

export function createOperatorAuthOptions(config: OperatorAuthConfig, now: () => number = Date.now): NextAuthConfig {
  const allowed = (email: string) => config.allowedEmails.includes(email.toLowerCase());
  const secure = new URL(config.origin).protocol === "https:";
  const cookie = (name: string) => ({ name: `${secure ? "__Host-" : ""}bloombox.operator-${name}`,
    options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure } });
  return {
    basePath: OPERATOR_AUTH_PATH, secret: config.secret, trustHost: true,
    useSecureCookies: secure,
    cookies: { sessionToken: cookie("session"), csrfToken: cookie("csrf"), callbackUrl: cookie("callback"),
      pkceCodeVerifier: cookie("pkce"), state: cookie("state"), nonce: cookie("nonce") },
    providers: [Google({ clientId: config.clientId, clientSecret: config.clientSecret,
      [customFetch]: createGoogleTokenFetch(config.clientId),
      checks: ["pkce", "state", "nonce"], authorization: { params: { scope: "openid email", prompt: "select_account" } } })],
    session: { strategy: "jwt", maxAge: OPERATOR_SESSION_SECONDS },
    jwt: { maxAge: OPERATOR_SESSION_SECONDS },
    pages: { signIn: "/operations", error: "/operations" },
    callbacks: {
      async signIn({ account, profile }) {
        const value = profileSchema.safeParse(profile);
        return account?.provider === "google" && value.success && account.providerAccountId === value.data.sub && allowed(value.data.email);
      },
      async jwt({ token, account, profile }) {
        if (account) {
          const value = profileSchema.safeParse(profile);
          if (account.provider !== "google" || !value.success || account.providerAccountId !== value.data.sub || !allowed(value.data.email)) return null;
          return { googleSubject: value.data.sub, operatorEmail: value.data.email.toLowerCase(), loginExpiresAt: now() + OPERATOR_SESSION_SECONDS * 1000 };
        }
        // Session-update payloads are deliberately ignored. Identity comes only from the verified login.
        const value = tokenSchema.safeParse(token);
        if (!value.success || !allowed(value.data.operatorEmail) || value.data.loginExpiresAt <= now()
          || value.data.loginExpiresAt > now() + OPERATOR_SESSION_SECONDS * 1000) return null;
        return value.data;
      },
      async session({ token }) {
        const value = tokenSchema.parse(token);
        return { user: { id: value.googleSubject }, expires: new Date(value.loginExpiresAt).toISOString() };
      },
      async redirect() { return `${config.origin}/operations`; },
    },
    // Provider error objects can include tokens, profiles or callback URLs. Emit fixed categories only.
    logger: {
      error() { console.error("operator_auth_error"); },
      warn() { console.warn("operator_auth_warning"); },
      debug() {},
    },
    debug: false,
  };
}
