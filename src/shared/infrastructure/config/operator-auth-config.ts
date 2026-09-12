import { z } from "zod";
const subject = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);
const origin = z.url().refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash && url.pathname === "/"
    && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
}).transform((value) => new URL(value).origin);
const schema = z.object({
  AUTH_URL: origin, AUTH_SECRET: z.string().min(32).max(512),
  AUTH_GOOGLE_ID: z.string().regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/),
  AUTH_GOOGLE_SECRET: z.string().min(16).max(1024),
  AUTH_OPERATOR_EMAILS: z.string().transform((value) => value.split(",").map((email) => email.trim().toLowerCase()))
    .pipe(z.array(z.email()).min(1).max(20)),
  AUTH_OPERATOR_BINDINGS: z.string().default("[]").transform((value, context) => {
    try { return JSON.parse(value); } catch { context.addIssue({ code: "custom", message: "Invalid bindings" }); return z.NEVER; }
  }).pipe(z.array(z.object({ subject, operatorId: z.uuid(), sessionVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict()).max(20))
    .refine((values) => new Set(values.map((v) => v.subject)).size === values.length && new Set(values.map((v) => v.operatorId)).size === values.length),
  OPERATOR_SHOPIFY_MODE: z.enum(["test", "live"]).default("test"),
});
export type OperatorAuthConfig = Readonly<{
  origin: string; secret: string; clientId: string; clientSecret: string; allowedEmails: readonly string[];
  bindings: ReadonlyArray<Readonly<{ subject: string; operatorId: string; sessionVersion?: number }>>; testMode: boolean;
}>;
export class InvalidOperatorAuthConfigurationError extends Error {
  constructor() { super("Operator authentication configuration is invalid"); this.name = "InvalidOperatorAuthConfigurationError"; }
}
export function loadOperatorAuthConfig(environment: Readonly<Record<string, string | undefined>> = process.env): OperatorAuthConfig | null {
  if (environment.AUTH_OPERATOR_ENABLED === undefined || environment.AUTH_OPERATOR_ENABLED === "false") return null;
  if (environment.AUTH_OPERATOR_ENABLED !== "true") throw new InvalidOperatorAuthConfigurationError();
  const parsed = schema.safeParse(environment);
  // These automatic library overrides would bypass this deliberately narrow configuration boundary.
  if (!parsed.success || environment.AUTH_REDIRECT_PROXY_URL || environment.NEXTAUTH_URL) throw new InvalidOperatorAuthConfigurationError();
  const value = parsed.data;
  return { origin: value.AUTH_URL, secret: value.AUTH_SECRET, clientId: value.AUTH_GOOGLE_ID, clientSecret: value.AUTH_GOOGLE_SECRET,
    allowedEmails: value.AUTH_OPERATOR_EMAILS, bindings: value.AUTH_OPERATOR_BINDINGS, testMode: value.OPERATOR_SHOPIFY_MODE === "test" };
}
