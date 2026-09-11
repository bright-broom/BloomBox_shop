import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_INBOX_MONITOR_URL: z.string().url(),
  DATABASE_SSL_MODE: z.enum(["verify-full", "disable"]).default("verify-full"),
});
export class InvalidInboxMonitorConfigurationError extends Error {
  constructor() { super("Inbox monitor configuration is invalid"); this.name = "InvalidInboxMonitorConfigurationError"; }
}
export function loadInboxMonitorConfig(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) throw new InvalidInboxMonitorConfigurationError();
  const url = new URL(parsed.data.DATABASE_INBOX_MONITOR_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)
    || url.search || url.hash || (parsed.data.DATABASE_SSL_MODE === "disable" && !["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new InvalidInboxMonitorConfigurationError();
  }
  return { url: url.toString(), ssl: parsed.data.DATABASE_SSL_MODE === "disable" ? false as const : "verify-full" as const };
}
