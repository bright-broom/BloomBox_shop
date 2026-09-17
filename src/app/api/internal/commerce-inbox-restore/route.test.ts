import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { execute, authorize, report } = vi.hoisted(() => ({ execute: vi.fn(), authorize: vi.fn(), report: vi.fn() }));
vi.mock("@/shared/infrastructure/composition-root", () => ({ getStripeInboxRecovery: () => ({ execute }) }));
vi.mock("@/shared/infrastructure/security/worker-authorization", () => ({ isAuthorizedCommerceWorkerRequest: authorize }));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({ reportUnexpectedError: report }));
import { POST } from "./route";
const body = { externalEventId: "evt_syntheticRecovery001", incidentIssue: 137, requestedBy: "synthetic-operator" };
const request = (value: unknown = body) => new Request(new URL("restore", import.meta.url), { method: "POST", body: JSON.stringify(value) });
function streamingRequest(stream: ReadableStream<Uint8Array>): Request {
  return new Request(new URL("restore", import.meta.url), { method: "POST", body: stream, duplex: "half" } as RequestInit);
}
afterEach(() => vi.useRealTimers());
describe("protected Inbox recovery endpoint", () => {
  beforeEach(() => { vi.resetAllMocks(); authorize.mockReturnValue(true); execute.mockResolvedValue({ outcome: "RESTORED" }); });
  it("authorizes before reading request or calling dependencies", async () => {
    authorize.mockReturnValue(false); expect((await POST(request())).status).toBe(401); expect(execute).not.toHaveBeenCalled();
  });
  it.each([{ ...body, payload: {} }, { ...body, externalEventIds: [body.externalEventId] }, { ...body, incidentIssue: 0 }, { ...body, requestedBy: ["email", "example.test"].join("@") }, null])("rejects invalid input", async (value) => {
    expect((await POST(request(value))).status).toBe(400); expect(execute).not.toHaveBeenCalled();
  });
  it("bounds actual streamed input independent of content length", async () => {
    const input = request({ ...body, requestedBy: "x".repeat(2_000) });
    input.headers.set("content-length", "1");
    expect((await POST(input)).status).toBe(400); expect(execute).not.toHaveBeenCalled();
  });
  it("rejects infinite empty chunks and releases the reader without calling recovery", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array()); }, cancel });
    expect((await POST(streamingRequest(stream))).status).toBe(400);
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false); expect(execute).not.toHaveBeenCalled();
  });
  it("rejects a stalled source by its whole-request deadline even if cancellation stalls", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([123])); }, cancel });
    const result = POST(streamingRequest(stream));
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await result).status).toBe(400); expect(execute).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects invalid UTF-8 instead of replacing invalid bytes inside otherwise valid JSON", async () => {
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoded.subarray(0, 2)); c.enqueue(new Uint8Array([255])); c.enqueue(encoded.subarray(2)); c.close(); } });
    expect((await POST(streamingRequest(stream))).status).toBe(400); expect(execute).not.toHaveBeenCalled();
  });
  it("accepts valid JSON split into single-byte chunks", async () => {
    const encoded = new TextEncoder().encode(JSON.stringify(body)); let index = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { if (index === encoded.length) c.close(); else c.enqueue(encoded.subarray(index, ++index)); } });
    expect(await (await POST(streamingRequest(stream))).json()).toEqual({ ok: true, outcome: "RESTORED" });
    expect(execute).toHaveBeenCalledWith(body);
  });
  it("returns safe outcome and prevents caching", async () => {
    const response = await POST(request()); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, outcome: "RESTORED" }); expect(execute).toHaveBeenCalledWith(body);
  });
  it("unavailable event is explicitly not successful", async () => {
    execute.mockResolvedValue({ outcome: "PROVIDER_UNAVAILABLE" }); expect(await (await POST(request())).json()).toEqual({ ok: false, outcome: "PROVIDER_UNAVAILABLE" });
  });
  it("hides unexpected error details", async () => {
    execute.mockRejectedValue(new Error("private")); const response = await POST(request()); expect(response.status).toBe(500); expect(await response.text()).not.toContain("private");
  });
});
