import { z } from "zod";
import { AD_CONSENT_DAYS } from "../domain/conversion";
import { clickIdSchema } from "../infrastructure/postgres-advertising-store";
import type { AdAttribution } from "../domain/conversion";
export const consentInputSchema = z.object({ choice: z.enum(["granted", "denied", "capture"]),
  gclid: clickIdSchema.optional(), gbraid: clickIdSchema.optional(), wbraid: clickIdSchema.optional(), fbclid: clickIdSchema.optional(),
}).strict();
export type ConsentChoice = "granted" | "denied" | "unknown";
export interface ConsentStore { active(token: string): Promise<boolean>; grant(attribution: AdAttribution): Promise<string>; revoke(token: string): Promise<void>; captureIfEmpty(token: string, attribution: AdAttribution): Promise<void> }
export async function consentChoice(token: string | undefined, live: boolean, store: () => ConsentStore): Promise<ConsentChoice> {
  if (token === "denied") return "denied";
  if (!live) return token === "preview-granted" ? "granted" : "unknown";
  return token && /^[a-f0-9]{64}$/.test(token) && await store().active(token) ? "granted" : "unknown";
}
export function advertisingCookieOptions(origin: string) {
  return { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax" as const, path: "/", maxAge: AD_CONSENT_DAYS * 24 * 60 * 60 };
}
export async function saveConsent(input: z.infer<typeof consentInputSchema>, token: string | undefined, live: boolean, userAgent: string, store: () => ConsentStore): Promise<string> {
  if (input.choice === "capture") throw new Error("Capture cannot grant consent");
  if (input.choice === "denied") {
    if (live && token && /^[a-f0-9]{64}$/.test(token)) await store().revoke(token);
    return "denied";
  }
  if (!live) return "preview-granted";
  const attribution = { gclid: input.gclid, gbraid: input.gbraid, wbraid: input.wbraid, fbclid: input.fbclid, capturedAt: Date.now(), userAgent: userAgent.slice(0, 512) };
  // First consenting touch is retained for 30 days. Repeated requests do not overwrite it.
  if (token && /^[a-f0-9]{64}$/.test(token) && await store().active(token)) { await store().captureIfEmpty(token, attribution); return token; }
  return store().grant(attribution);
}

/** Background attribution is never allowed to create or renew consent. */
export async function captureConsentedAttribution(input: z.infer<typeof consentInputSchema>, token: string | undefined, live: boolean, userAgent: string, store: () => ConsentStore): Promise<void> {
  if (!live || !token || !/^[a-f0-9]{64}$/.test(token) || !await store().active(token)) return;
  await store().captureIfEmpty(token, { gclid: input.gclid, gbraid: input.gbraid, wbraid: input.wbraid, fbclid: input.fbclid, capturedAt: Date.now(), userAgent: userAgent.slice(0, 512) });
}
