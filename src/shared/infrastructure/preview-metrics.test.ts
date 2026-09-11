import { describe, expect, it } from "vitest";
import { recordPreviewMetric, readPreviewMetrics, setPreviewMetricsEnabled } from "./preview-metrics";

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
describe("opt-in local preview metrics", () => {
  it("defaults off, rejects PII and real purchases, deduplicates completion, and deletes on stop", () => {
    const store = storage();
    const event = { name: "preview_purchase", requestId: "12345678-abcd-4000-8000-123456789012", referralUsed: true };
    expect(recordPreviewMetric(event, store)).toBe("disabled");
    setPreviewMetricsEnabled(store, true);
    expect(recordPreviewMetric({ ...event, email: "test@example.test" }, store)).toBe("invalid");
    expect(recordPreviewMetric({ ...event, name: "purchase" }, store)).toBe("invalid");
    expect(recordPreviewMetric(event, store)).toBe("recorded");
    expect(recordPreviewMetric(event, store)).toBe("duplicate");
    expect(readPreviewMetrics(store)).toHaveLength(1);
    setPreviewMetricsEnabled(store, false);
    expect(readPreviewMetrics(store)).toBeNull();
  });
  it("does not interrupt checkout when storage fails or the diagnostic buffer is full", () => {
    expect(recordPreviewMetric({ name: "recipient_page_view" }, { ...storage(), getItem: () => { throw new Error("Storage blocked"); } })).toBe("unavailable");
    const store = storage(); setPreviewMetricsEnabled(store, true);
    for (let i = 0; i < 200; i++) recordPreviewMetric({ name: "recipient_page_view" }, store);
    expect(recordPreviewMetric({ name: "recipient_page_view" }, store)).toBe("full");
    expect(readPreviewMetrics(store)).toHaveLength(200);
  });
});
