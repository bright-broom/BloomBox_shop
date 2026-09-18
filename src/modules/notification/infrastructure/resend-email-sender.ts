import { z } from "zod";
import { EmailRejectedError, type EmailSender, type OutgoingEmail } from "../application/deliver-notifications";

const TIMEOUT_MS = 4_000;
const RESPONSE_LIMIT = 16_384;

export type ResendSettings = Readonly<{ apiUrl: string; apiKey: string; from: string; replyTo?: string }>;

/** A transient provider failure. Carries no response body, address, or credential. */
export class EmailProviderUnavailableError extends Error {
  constructor() {
    super("Email provider is unavailable");
    this.name = "EmailProviderUnavailableError";
  }
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > RESPONSE_LIMIT) {
      await reader.cancel();
      throw new EmailProviderUnavailableError();
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Sends plain-text mail through the Resend HTTP API. The Idempotency-Key deduplicates a resend for 24 hours. */
export class ResendEmailSender implements EmailSender {
  constructor(private readonly settings: ResendSettings, private readonly fetcher: typeof fetch = fetch) {}

  async send(email: OutgoingEmail): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(this.settings.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": email.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.settings.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          ...(this.settings.replyTo ? { reply_to: this.settings.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new EmailProviderUnavailableError();
    }
    if (!response.ok) {
      await response.body?.cancel();
      // 409 is an in-flight request with the same key; 408/429/5xx are temporary. Other 4xx cannot succeed as sent.
      if (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500) {
        throw new EmailProviderUnavailableError();
      }
      throw new EmailRejectedError();
    }
    try {
      return z.object({ id: z.string().min(1).max(128) }).parse(JSON.parse(await readLimited(response))).id;
    } catch {
      // Accepted without a readable ID: the provider has the message, so do not resend it.
      return "accepted";
    }
  }
}
