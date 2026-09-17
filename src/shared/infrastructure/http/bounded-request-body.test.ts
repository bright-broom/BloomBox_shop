import { afterEach, describe, expect, it, vi } from "vitest";
import { readBoundedRequestBody } from "./bounded-request-body";

const limits = { maxBytes: 8, timeoutMs: 50 };
afterEach(() => vi.useRealTimers());

function request(body: ReadableStream<Uint8Array>, headers?: HeadersInit): Request {
  return new Request("https://example.test/body", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

describe("bounded HTTP body", () => {
  it("rejects an infinite stream of empty chunks without starving the deadline", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array()); }, cancel });
    await expect(readBoundedRequestBody(request(stream), limits)).rejects.toMatchObject({ status: 400 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("releases each read timer when many one-byte chunks arrive", async () => {
    vi.useFakeTimers();
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) {
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
      if (sent++ < 4096) c.enqueue(new Uint8Array([1])); else c.close();
    } });
    expect(await readBoundedRequestBody(request(stream), { maxBytes: 4096, timeoutMs: 2000 })).toHaveLength(4096);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves exact bytes split across chunks at the limit", async () => {
    const bytes = new TextEncoder().encode("花ab花");
    const stream = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(bytes.subarray(0, 2)); c.enqueue(bytes.subarray(2)); c.close();
    } });
    expect(await readBoundedRequestBody(request(stream), limits)).toEqual(bytes);
  });

  it.each([undefined, "1"])("cancels an oversized stream despite Content-Length %s", async (declared) => {
    const cancel = vi.fn();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(5)); }, cancel });
    await expect(readBoundedRequestBody(request(stream, declared ? { "content-length": declared } : undefined), limits))
      .rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulled).toBeLessThanOrEqual(3);
    expect(stream.locked).toBe(false);
  });

  it.each(["-1", "NaN", "1e8", "1.5"])("rejects malformed Content-Length %s before reading", async (declared) => {
    const read = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull: read }, { highWaterMark: 0 });
    await expect(readBoundedRequestBody(request(stream, { "content-length": declared }), limits)).rejects.toMatchObject({ status: 400 });
    expect(read).not.toHaveBeenCalled();
  });

  it("times out once for the entire stream even when cancellation never settles", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(1)); }, cancel });
    const result = expect(readBoundedRequestBody(request(stream), limits)).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(50);
    await result;
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it("translates a disconnected stream into a safe failure", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error("sensitive detail")); } });
    await expect(readBoundedRequestBody(request(stream), limits)).rejects.toMatchObject({ status: 400 });
  });
});
