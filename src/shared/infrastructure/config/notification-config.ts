import { z } from "zod";

/** Resend's HTTP API endpoint (ADR 0019). Other providers implement the EmailSender port instead. */
export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

const email = z.email().max(254);
const sender = z.string().max(320).refine((value) => {
  if (/[\r\n]/.test(value)) return false;
  const named = /^([^<>"]{1,64}) <([^<>\s]+)>$/.exec(value);
  return email.safeParse(named ? named[2] : value).success;
});
const schema = z.object({
  BLOOMBOX_RUNTIME_MODE: z.enum(["preview", "production"]).default("preview"),
  BLOOMBOX_PUBLIC_ORIGIN: z.url(),
  NOTIFICATION_EMAIL_FROM: sender,
  NOTIFICATION_EMAIL_REPLY_TO: email.optional(),
  RESEND_API_KEY: z.string().regex(/^re_[A-Za-z0-9_]{16,200}$/),
});

export type NotificationConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{ enabled: true; live: boolean; origin: string; apiUrl: string; apiKey: string; from: string; replyTo?: string }>;

export class InvalidNotificationConfigurationError extends Error {
  constructor() {
    super("Notification configuration is invalid");
    this.name = "InvalidNotificationConfigurationError";
  }
}

/** Off unless BLOOMBOX_NOTIFICATIONS_ENABLED=true. Mail is sent only by the production runtime (`live`). */
export function loadNotificationConfig(env: Readonly<Record<string, string | undefined>> = process.env): NotificationConfig {
  const enabled = env.BLOOMBOX_NOTIFICATIONS_ENABLED;
  if (enabled === undefined || enabled === "" || enabled === "false") return { enabled: false };
  if (enabled !== "true") throw new InvalidNotificationConfigurationError();
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new InvalidNotificationConfigurationError();
  const value = parsed.data;
  const origin = new URL(value.BLOOMBOX_PUBLIC_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new InvalidNotificationConfigurationError();
  }
  return {
    enabled: true,
    live: value.BLOOMBOX_RUNTIME_MODE === "production",
    origin: origin.origin,
    apiUrl: RESEND_EMAILS_URL,
    apiKey: value.RESEND_API_KEY,
    from: value.NOTIFICATION_EMAIL_FROM,
    replyTo: value.NOTIFICATION_EMAIL_REPLY_TO,
  };
}
