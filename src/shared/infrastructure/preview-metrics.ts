import { z } from "zod";

const KEY = "bloombox.preview-metrics.v1";
const CAPACITY = 200;
export const PREVIEW_METRICS_CHANGED = "bloombox:preview-metrics-changed";
function notify() { if (typeof window !== "undefined") window.dispatchEvent(new Event(PREVIEW_METRICS_CHANGED)); }
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const productId = z.string().regex(/^prod_[a-z0-9_]{1,60}$/);
export const previewMetricSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("product_view"), productId }).strict(),
  z.object({ name: z.literal("size_select"), size: z.enum(["M", "L"]) }).strict(),
  z.object({ name: z.literal("gift_start"), productId }).strict(),
  z.object({ name: z.literal("begin_checkout"), requestId: z.uuid() }).strict(),
  z.object({ name: z.literal("preview_purchase"), requestId: z.uuid(), referralUsed: z.boolean() }).strict(),
  z.object({ name: z.literal("recipient_page_view") }).strict(),
]);
export type PreviewMetric = z.infer<typeof previewMetricSchema>;
const stateSchema = z.object({ enabled: z.literal(true), events: z.array(previewMetricSchema).max(CAPACITY) }).strict();

export function readPreviewMetrics(storage: StorageLike): PreviewMetric[] | null {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  const parsed = stateSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data.events : null;
}

export function setPreviewMetricsEnabled(storage: StorageLike, enabled: boolean): void {
  if (enabled) storage.setItem(KEY, JSON.stringify({ enabled: true, events: [] }));
  else storage.removeItem(KEY);
  notify();
}

/** Opt-in, this-tab diagnostics only. No network calls or production purchase events. */
export function recordPreviewMetric(input: unknown, providedStorage?: StorageLike): string {
  const parsed = previewMetricSchema.safeParse(input);
  if (!parsed.success) return "invalid";
  try {
    const storage = providedStorage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);
    if (!storage) return "disabled";
    const events = readPreviewMetrics(storage);
    if (!events) return "disabled";
    const event = parsed.data;
    // A reload/retry must not increase checkout/purchase counts for this request.
    if ("requestId" in event && events.some((entry) => "requestId" in entry && entry.name === event.name && entry.requestId === event.requestId)) return "duplicate";
    if (events.length >= CAPACITY) return "full"; // Do not evict deduplication evidence.
    storage.setItem(KEY, JSON.stringify({ enabled: true, events: [...events, event] }));
    notify();
    return "recorded";
  } catch {
    // Browser diagnostics must never interrupt checkout; the opt-in panel exposes storage failures.
    return "unavailable";
  }
}
