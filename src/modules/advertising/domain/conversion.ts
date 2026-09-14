export const AD_CONSENT_DAYS = 30;
export const AD_DELIVERY_WINDOW_MS = 47 * 60 * 60 * 1000;
export const AD_RETRY_LIMIT = 5;
export type AdvertisingProvider = "google" | "meta" | "webhook";
export type AdAttribution = Readonly<{
  gclid?: string; gbraid?: string; wbraid?: string; fbclid?: string;
  capturedAt: number; userAgent: string;
}>;
export type PurchaseConversion = Readonly<{
  eventId: string; occurredAt: string; value: number; currency: "JPY";
}>;
export type ConversionFacts = Readonly<{
  orderId: string; confirmedAt: Date; value: number; currency: "JPY";
}>;
export function purchaseConversion(facts: ConversionFacts, now: Date): PurchaseConversion | null {
  const age = now.getTime() - facts.confirmedAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age > AD_DELIVERY_WINDOW_MS
    || !Number.isSafeInteger(facts.value) || facts.value <= 0) return null;
  return { eventId: `purchase_${facts.orderId}`, occurredAt: facts.confirmedAt.toISOString(), value: facts.value, currency: facts.currency };
}
export function hasAttribution(provider: AdvertisingProvider, attribution: AdAttribution): boolean {
  if (provider === "google") return Boolean(attribution.gclid || attribution.gbraid || attribution.wbraid);
  if (provider === "meta") return Boolean(attribution.fbclid);
  return Boolean(attribution.gclid || attribution.gbraid || attribution.wbraid || attribution.fbclid);
}
