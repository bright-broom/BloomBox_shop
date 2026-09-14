import { describe, expect, it, vi } from "vitest";
import { createAdvertisingDestinations, AdvertisingProviderError } from "./destinations";
import type { AdvertisingConfig } from "@/shared/infrastructure/config/advertising-config";
const config: AdvertisingConfig = { enabled: true, live: true, origin: "https://shop.example",
  google: { customerId: "1234567890", conversionActionId: "456", clientId: "client", clientSecret: "secret", refreshToken: "refresh" },
  meta: { pixelId: "123", accessToken: "token", apiVersion: "v24.0" }, webhook: { url: "https://collector.example/events", secret: "secret" } };
const event = { eventId: "purchase_123", occurredAt: "2026-09-14T00:00:00.000Z", value: 5500, currency: "JPY" as const };
const attribution = { gclid: "click", fbclid: "metaClick", capturedAt: 1789343999000, userAgent: "TestBrowser" };
describe("advertising destinations", () => {
  it("does not construct live transports for disabled or preview runtime", () => {
    expect(createAdvertisingDestinations({ ...config, live: false })).toEqual([]);
    expect(createAdvertisingDestinations({ ...config, enabled: false })).toEqual([]);
  });
  it("uses Google Data Manager, explicit consent, stable IDs and server JPY without PII", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: "secret-token" })).mockResolvedValueOnce(Response.json({ requestId: "request1" }));
    const destination = createAdvertisingDestinations(config, fetcher)[0];
    expect(await destination.send(event, attribution)).toBe("request1");
    expect(fetcher.mock.calls[1][0]).toBe("https://datamanager.googleapis.com/v1/events:ingest");
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body.events[0]).toEqual({ transactionId: "purchase_123", eventTimestamp: event.occurredAt, conversionValue: 5500, currency: "JPY", eventSource: "WEB", adIdentifiers: { gclid: "click" } });
    expect(body.consent).toEqual({ adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_DENIED" });
    expect(body.events[0].userData).toBeUndefined();
  });
  it("Meta receives only the matching click, browser type and purchase fact with a clean URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ events_received: 1, fbtrace_id: "trace" }));
    await createAdvertisingDestinations(config, fetcher)[1].send(event, attribution);
    const request = fetcher.mock.calls[0][1]; const body = JSON.parse(String(request?.body));
    expect(body.data[0].user_data).toEqual({ fbc: `fb.1.${attribution.capturedAt}.metaClick`, client_user_agent: "TestBrowser" });
    expect(body.data[0].event_source_url).toBe("https://shop.example/checkout/success");
    expect(body.data[0].custom_data.value).toBe(5500);
    expect(body.data[0].event_id).toBe(event.eventId);
    expect(request?.redirect).toBe("error");
  });
  it("signs generic webhooks and omits all attribution identifiers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ accepted: true }));
    await createAdvertisingDestinations(config, fetcher)[2].send(event, attribution);
    const request = fetcher.mock.calls[0][1];
    expect(JSON.parse(String(request?.body))).toEqual({ version: 1, type: "purchase", ...event });
    expect(request?.headers).toMatchObject({ "Idempotency-Key": event.eventId, "X-BloomBox-Signature": expect.stringMatching(/^v1=[a-f0-9]{64}$/) });
  });
  it.each([new Response('private data', { status: 429 }), Response.json({ events_received: 0 }), new Response('a'.repeat(32769))])("rejects transport and payload failures without leaking a response", async (response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(createAdvertisingDestinations(config, fetcher)[1].send(event, attribution)).rejects.toBeInstanceOf(AdvertisingProviderError);
  });
});
