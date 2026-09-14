import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadAdvertisingConfig } from "@/shared/infrastructure/config/advertising-config";
import { advertisingCookieName, advertisingStore } from "@/shared/infrastructure/advertising-runtime";
import { advertisingCookieOptions, captureConsentedAttribution, consentChoice, consentInputSchema, saveConsent } from "@/modules/advertising/presentation/consent-handler";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
export async function GET() {
  try {
    const config = loadAdvertisingConfig();
    if (!config.enabled) return response({ enabled: false, choice: "unknown" });
    const token = (await cookies()).get(advertisingCookieName(config))?.value;
    return response({ enabled: true, choice: await consentChoice(token, config.live, advertisingStore) });
  } catch (error) { reportUnexpectedError(error, { operation: "advertising_consent_read" }); return response({ error: true }, 503); }
}
export async function POST(request: Request) {
  try {
    const config = loadAdvertisingConfig();
    if (!config.enabled) return response({ enabled: false }, 404);
    if (request.headers.get("origin") !== config.origin || request.headers.get("sec-fetch-site") === "cross-site") return response({ error: true }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ error: true }, 415);
    // Read with a byte bound, including chunked bodies without Content-Length.
    const reader = request.body?.getReader(); if (!reader) return response({ error: true }, 400);
    let bytes = 0; const chunks: Uint8Array[] = [];
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length;
      if (bytes > 4096) { await reader.cancel(); return response({ error: true }, 413); } chunks.push(part.value); }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return response({ error: true }, 400); }
    const input = consentInputSchema.safeParse(raw); if (!input.success) return response({ error: true }, 400);
    const jar = await cookies(); const name = advertisingCookieName(config);
    if (input.data.choice === "capture") {
      await captureConsentedAttribution(input.data, jar.get(name)?.value, config.live, request.headers.get("user-agent") ?? "", advertisingStore);
      return response({ ok: true });
    }
    const token = await saveConsent(input.data, jar.get(name)?.value, config.live, request.headers.get("user-agent") ?? "", advertisingStore);
    const result = response({ enabled: true, choice: input.data.choice });
    result.cookies.set(name, token, advertisingCookieOptions(config.origin));
    return result;
  } catch (error) { reportUnexpectedError(error, { operation: "advertising_consent_save" }); return response({ error: true }, 503); }
}
