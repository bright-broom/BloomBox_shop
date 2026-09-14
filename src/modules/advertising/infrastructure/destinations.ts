import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import type { AdvertisingConfig } from "@/shared/infrastructure/config/advertising-config";
import type { AdvertisingDestination } from "../application/deliver-conversions";
import type { AdAttribution, PurchaseConversion } from "../domain/conversion";
const TIMEOUT_MS = 4_000;
const RESPONSE_LIMIT = 32_768;
export class AdvertisingProviderError extends Error { constructor() { super("Advertising provider request failed"); this.name = "AdvertisingProviderError"; } }
// Never include response bodies, URLs with credentials, or identifiers in errors/logs.
async function post(fetcher: typeof fetch, url: string, body: string, headers: Record<string, string>): Promise<unknown> {
  try {
    const response = await fetcher(url, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", cache: "no-store" });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new AdvertisingProviderError(); }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > RESPONSE_LIMIT) { await reader.cancel(); throw new AdvertisingProviderError(); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new AdvertisingProviderError(); }
}
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
export function createAdvertisingDestinations(config: AdvertisingConfig, fetcher: typeof fetch = fetch): AdvertisingDestination[] {
  if (!config.enabled || !config.live) return [];
  const result: AdvertisingDestination[] = [];
  const google = config.google;
  if (google) result.push({ provider: "google", fingerprint: fingerprint(`google:${google.customerId}:${google.conversionActionId}`), async send(event, attribution) {
    const token = z.object({ access_token: z.string().min(1) }).parse(await post(fetcher, "https://oauth2.googleapis.com/token", new URLSearchParams({
      grant_type: "refresh_token", client_id: google.clientId, client_secret: google.clientSecret, refresh_token: google.refreshToken,
    }).toString(), { "Content-Type": "application/x-www-form-urlencoded" }));
    const receipt = z.object({ requestId: z.string().min(1).max(512) }).safeParse(await post(fetcher, "https://datamanager.googleapis.com/v1/events:ingest", JSON.stringify({
      destinations: [{ operatingAccount: { accountType: "GOOGLE_ADS", accountId: google.customerId }, productDestinationId: google.conversionActionId }],
      consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_DENIED" },
      events: [googleEvent(event, attribution)],
    }), { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }));
    if (!receipt.success) throw new AdvertisingProviderError();
    return receipt.data.requestId;
  } });
  const meta = config.meta;
  if (meta) result.push({ provider: "meta", fingerprint: fingerprint(`meta:${meta.pixelId}`), async send(event, attribution) {
    const receipt = z.object({ events_received: z.literal(1), fbtrace_id: z.string().max(512).optional() }).safeParse(await post(fetcher,
      `https://graph.facebook.com/${meta.apiVersion}/${meta.pixelId}/events`, JSON.stringify({ data: [metaEvent(event, attribution, config.origin)] }),
      { Authorization: `Bearer ${meta.accessToken}`, "Content-Type": "application/json" }));
    if (!receipt.success) throw new AdvertisingProviderError();
    return receipt.data.fbtrace_id ?? event.eventId;
  } });
  const webhook = config.webhook;
  if (webhook) result.push({ provider: "webhook", fingerprint: fingerprint(`webhook:${webhook.url}`), async send(event) {
    // The generic destination receives no click IDs, browser details, or customer fields.
    const body = JSON.stringify({ version: 1, type: "purchase", ...event });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", webhook.secret).update(`${timestamp}.${body}`).digest("hex");
    const receipt = z.object({ accepted: z.literal(true) }).safeParse(await post(fetcher, webhook.url, body, {
      "Content-Type": "application/json", "Idempotency-Key": event.eventId,
      "X-BloomBox-Timestamp": timestamp, "X-BloomBox-Signature": `v1=${signature}`,
    }));
    if (!receipt.success) throw new AdvertisingProviderError();
    return event.eventId;
  } });
  return result;
}
export function googleEvent(event: PurchaseConversion, attribution: AdAttribution) {
  const adIdentifiers = attribution.gclid ? { gclid: attribution.gclid } : attribution.gbraid ? { gbraid: attribution.gbraid } : { wbraid: attribution.wbraid };
  return { transactionId: event.eventId, eventTimestamp: event.occurredAt, conversionValue: event.value, currency: event.currency, eventSource: "WEB", adIdentifiers };
}
export function metaEvent(event: PurchaseConversion, attribution: AdAttribution, origin: string) {
  return { event_name: "Purchase", event_id: event.eventId, event_time: Math.floor(Date.parse(event.occurredAt) / 1000), action_source: "website",
    event_source_url: `${origin}/checkout/success`,
    user_data: { fbc: `fb.1.${attribution.capturedAt}.${attribution.fbclid}`, client_user_agent: attribution.userAgent },
    custom_data: { value: event.value, currency: event.currency },
  };
}
