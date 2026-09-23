import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

/** Operator check for the transactional mail provider: credentials, sender domain and real delivery. */
export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;
const RESPONSE_LIMIT = 16_384;

class NotificationCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotificationCheckError";
  }
}
function assert(condition, message) {
  if (!condition) throw new NotificationCheckError(message);
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function notificationCheckSettings(env) {
  const from = env.NOTIFICATION_EMAIL_FROM ?? "";
  const recipient = env.NOTIFICATION_TEST_RECIPIENT ?? "";
  const key = env.RESEND_API_KEY ?? "";
  const replyTo = env.NOTIFICATION_EMAIL_REPLY_TO;
  assert(!/[\r\n]/.test(from) && EMAIL.test(/^[^<>"]{1,64} <([^<>\s]+)>$/.exec(from)?.[1] ?? from),
    "NOTIFICATION_EMAIL_FROM must be an address on the authenticated sending domain, optionally as 'Name <address>'");
  assert(EMAIL.test(recipient), "NOTIFICATION_TEST_RECIPIENT must be the address that receives this check; it is never taken from customer data");
  assert(/^re_[A-Za-z0-9_]{16,200}$/.test(key), "RESEND_API_KEY must be a send-only API key");
  assert(replyTo === undefined || EMAIL.test(replyTo), "NOTIFICATION_EMAIL_REPLY_TO must be an email address");
  return { from, recipient, key, replyTo, apiUrl: env.NOTIFICATION_API_URL ?? RESEND_EMAILS_URL };
}

/** Fixed wording, never customer content: this message must be recognisable as a check in the inbox. */
export function checkMessage(reference) {
  return {
    subject: `【BLOOM BOX】送信設定の確認（${reference}）`,
    text: [
      "これはBLOOM BOXの送信設定を確認するためのメールです。お客様への通知ではありません。",
      "",
      `確認ID：${reference}`,
      "",
      "このメールが迷惑メールに入らず届いていれば、送信元ドメインの認証とAPIキーは有効です。",
      "注文確認と発送のお知らせの本文は、この確認メールとは別に管理しています。",
    ].join("\n"),
  };
}

async function readLimited(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > RESPONSE_LIMIT) { await reader.cancel(); return ""; }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function verifyNotificationDelivery(env = process.env, { dryRun = false, log = console.log, fetcher = fetch } = {}) {
  const settings = notificationCheckSettings(env);
  const reference = randomUUID();
  const message = checkMessage(reference);
  log(`Sender: ${settings.from}`);
  log(`Recipient: ${settings.recipient}`);
  log(`Endpoint: ${new URL(settings.apiUrl).origin}`);
  if (dryRun) {
    log("Dry run: nothing was sent.");
    log(`Subject: ${message.subject}`);
    return { sent: false, reference };
  }
  let response;
  try {
    response = await fetcher(settings.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": reference,
      },
      body: JSON.stringify({
        from: settings.from,
        to: [settings.recipient],
        subject: message.subject,
        text: message.text,
        ...(settings.replyTo ? { reply_to: settings.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    // Never surface the cause: it can contain the endpoint's response or the key from the request.
    throw new NotificationCheckError("The mail provider could not be reached");
  }
  if (!response.ok) {
    await response.body?.cancel();
    assert(false, response.status === 401 || response.status === 403
      ? "The mail provider rejected the API key"
      : response.status === 422 || response.status === 400
        ? "The mail provider rejected the sender or recipient; check the authenticated sending domain"
        : `The mail provider returned HTTP ${response.status}`);
  }
  const id = /"id"\s*:\s*"([A-Za-z0-9_-]{1,128})"/.exec(await readLimited(response))?.[1] ?? "accepted";
  log(`Accepted by the provider: ${id}`);
  log("Confirm the message arrived, including its spam classification, before enabling notifications.");
  return { sent: true, reference, id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyNotificationDelivery(process.env, { dryRun: process.argv.includes("--dry-run") })
    .catch((error) => { console.error(`Notification delivery check failed: ${error.message}`); process.exitCode = 1; });
}
