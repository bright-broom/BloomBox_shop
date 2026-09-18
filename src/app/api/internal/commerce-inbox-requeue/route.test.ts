import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute, reportUnexpectedError } = vi.hoisted(() => ({
  execute: vi.fn(),
  reportUnexpectedError: vi.fn().mockReturnValue("test-error-id"),
}));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  getStripeFailedInboxRequeue: () => ({ execute }),
}));
vi.mock("@/shared/infrastructure/config/worker-config", () => ({
  loadCommerceWorkerSecret: () => "a-secure-worker-secret-with-32-chars",
}));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({ reportUnexpectedError }));

import { POST } from "./route";

const validBody = { externalEventIds: ["evt_1234567890abcdef"], incidentIssue: 171, requestedBy: "bright-broom" };

function post(body: unknown, authorization = "Bearer a-secure-worker-secret-with-32-chars") {
  return new Request(new URL("requeue", import.meta.url), {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("commerce inbox requeue route", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    execute.mockReset();
    reportUnexpectedError.mockClear();
  });

  it("rejects an unauthenticated invocation before reading the request", async () => {
    const response = await POST(post(validBody, "Bearer wrong-secret"));
    expect(response.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { name: "malformed JSON", body: "{not json" },
    { name: "an invalid request", body: { ...validBody, externalEventIds: ["not-an-event"] } },
    { name: "a free-text reason", body: { ...validBody, reason: "details" } },
  ])("rejects $name without touching the Inbox", async ({ body }) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
    expect(execute).not.toHaveBeenCalled();
    expect(reportUnexpectedError).not.toHaveBeenCalled();
  });

  it("requeues the named events and reports each outcome", async () => {
    execute.mockResolvedValue({ results: [{ externalEventId: "evt_1234567890abcdef", outcome: "REQUEUED" }] });
    const response = await POST(post(validBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, results: [{ externalEventId: "evt_1234567890abcdef", outcome: "REQUEUED" }] });
    expect(execute).toHaveBeenCalledExactlyOnceWith(validBody);
  });

  it("reports an unexpected failure without exposing details", async () => {
    execute.mockRejectedValue(new Error("private database detail"));
    const response = await POST(post(validBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
    expect(reportUnexpectedError).toHaveBeenCalledOnce();
  });
});

function streamingPost(stream: ReadableStream<Uint8Array>, authorization = "Bearer a-secure-worker-secret-with-32-chars") {
  return new Request(new URL("requeue", import.meta.url), {
    method: "POST", headers: { authorization }, body: stream, duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("requeue transport limits", () => {
  beforeEach(() => { execute.mockReset(); reportUnexpectedError.mockClear(); });
  afterEach(() => vi.useRealTimers());
  it.each([undefined, "1", "16385", "invalid"])("rejects oversized or invalid input regardless of declared length %s", async (length) => {
    const request = post(JSON.stringify(validBody).padEnd(16_385, " "));
    if (length !== undefined) request.headers.set("content-length", length);
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(execute).not.toHaveBeenCalled();
    expect(reportUnexpectedError).not.toHaveBeenCalled();
  });
  it("rejects a stalled stream and releases the reader even when cancellation stalls", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([123])); }, cancel });
    const response = POST(streamingPost(stream));
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await response).status).toBe(400);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(reportUnexpectedError).not.toHaveBeenCalled();
  });
  it("authenticates before acquiring a reader", async () => {
    const request = streamingPost(new ReadableStream<Uint8Array>(), "Bearer wrong");
    const reader = vi.spyOn(request.body!, "getReader");
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(reader).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects invalid UTF-8", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([255])); c.close(); } });
    expect((await POST(streamingPost(stream))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it("accepts all 20 maximum-length IDs at the byte boundary", async () => {
    const body = { externalEventIds: Array.from({ length: 20 }, (_, i) => "evt_" + String(i).padStart(255, "a")), incidentIssue: 1_000_000_000, requestedBy: "a".repeat(39) };
    execute.mockResolvedValue({ results: [] });
    const encoded = JSON.stringify(body).padEnd(16_384, " ");
    const response = await POST(post(encoded));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(execute).toHaveBeenCalledExactlyOnceWith(body);
  });
});
