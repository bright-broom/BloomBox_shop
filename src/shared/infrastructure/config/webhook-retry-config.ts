import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_WEBHOOK_ADMIN_URL: z.string().url(),
  DATABASE_SSL_MODE: z.enum(["verify-full", "disable"]).default("verify-full"),
});
export class InvalidWebhookRetryConfigurationError extends Error {
  constructor() { super("Webhook retry configuration is invalid"); this.name = "InvalidWebhookRetryConfigurationError"; }
}
export function loadWebhookRetryConfig(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) throw new InvalidWebhookRetryConfigurationError();
  const url = new URL(parsed.data.DATABASE_WEBHOOK_ADMIN_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)
    || url.search || url.hash || (parsed.data.DATABASE_SSL_MODE === "disable" && !["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new InvalidWebhookRetryConfigurationError();
  }
  return { url: url.toString(), ssl: parsed.data.DATABASE_SSL_MODE === "disable" ? false as const : "verify-full" as const };
}
