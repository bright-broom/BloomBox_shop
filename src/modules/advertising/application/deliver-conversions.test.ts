import { describe, expect, it, vi } from "vitest";
import { DeliverAdvertisingConversions, type AdvertisingDeliveryStore, type AdvertisingJob } from "./deliver-conversions";
const now = new Date("2026-09-14T02:00:00Z");
const job: AdvertisingJob = { id: "job", lease: "lease", intentId: "intent", provider: "google", destination: "account", attempts: 1, event: null };
const facts = { orderId: "order", confirmedAt: new Date("2026-09-14T01:00:00Z"), value: 5000, currency: "JPY" as const };
function setup(overrides: Partial<AdvertisingJob> = {}) {
  const store = { claim: vi.fn().mockResolvedValueOnce({ ...job, ...overrides }).mockResolvedValue(null), attribution: vi.fn().mockResolvedValue({ gclid: "click", capturedAt: now.getTime() - 7200000, userAgent: "browser" }), snapshot: vi.fn(), finish: vi.fn() } satisfies AdvertisingDeliveryStore;
  const read = vi.fn().mockResolvedValue(facts); const send = vi.fn().mockResolvedValue("request"); const report = vi.fn();
  return { store, read, send, report, worker: new DeliverAdvertisingConversions(store, read, [{ provider: "google", fingerprint: "account", send }], report, () => now) };
}
describe("verified purchase delivery", () => {
  it("snapshots before sending and calls a receipt accepted rather than attributed", async () => {
    const s = setup(); expect((await s.worker.execute()).accepted).toBe(1);
    expect(s.store.snapshot.mock.invocationCallOrder[0]).toBeLessThan(s.send.mock.invocationCallOrder[0]);
    expect(s.store.finish).toHaveBeenCalledWith(job, "accepted", "request");
    expect(s.store.attribution).toHaveBeenCalledTimes(2);
  });
  it("does not send for unconfirmed, refunded or non-live purchases returned as absent", async () => {
    const s = setup(); s.read.mockResolvedValue(null); await s.worker.execute(); expect(s.send).not.toHaveBeenCalled();
  });
  it("stops after consent withdrawal while the order query was running", async () => {
    const s = setup(); s.store.attribution.mockResolvedValueOnce({ gclid: "click", capturedAt: 1, userAgent: "browser" }).mockResolvedValue(null);
    await s.worker.execute(); expect(s.send).not.toHaveBeenCalled();
  });
  it("does not send old or future purchases", async () => {
    for (const confirmedAt of [new Date("2026-09-10T00:00:00Z"), new Date("2026-09-15T00:00:00Z")]) {
      const s = setup(); s.read.mockResolvedValue({ ...facts, confirmedAt }); await s.worker.execute(); expect(s.send).not.toHaveBeenCalled();
    }
  });
  it("does not attach a later consent or click to an earlier purchase", async () => {
    const s = setup(); s.store.attribution.mockResolvedValue({ gclid: "click", capturedAt: now.getTime(), userAgent: "browser" });
    await s.worker.execute(); expect(s.send).not.toHaveBeenCalled();
  });
  it("stops on destination changes instead of redirecting queued personal data", async () => {
    const s = setup({ destination: "different-account" }); await s.worker.execute(); expect(s.send).not.toHaveBeenCalled();
  });
  it("reuses event ID/time/value on retries and fails after the retry limit", async () => {
    const event = { eventId: "purchase_order", occurredAt: facts.confirmedAt.toISOString(), value: 5000, currency: "JPY" as const };
    const s = setup({ event, attempts: 5 }); s.send.mockRejectedValue(new Error("private"));
    expect((await s.worker.execute()).failed).toBe(1); expect(s.send).toHaveBeenCalledWith(event, expect.anything());
    expect(s.report).toHaveBeenCalledTimes(1);
  });
  it("does not reuse a snapshot after an authoritative amount changed", async () => {
    const s = setup({ event: { eventId: "purchase_order", occurredAt: facts.confirmedAt.toISOString(), value: 9999, currency: "JPY" } });
    await s.worker.execute(); expect(s.send).not.toHaveBeenCalled();
  });
});
