import { afterEach, describe, expect, it, vi } from "vitest";
import { googleAuthFetch } from "./google-fetch";
afterEach(() => vi.unstubAllGlobals());
describe("bounded Google authentication transport", () => {
  it("rejects unexpected destinations before sending credentials", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const url of ["http://accounts.google.com", "https://attacker.example", "https://accounts.google.com.attacker.example", "https://user:pass@accounts.google.com", "https://accounts.google.com:444"])
      await expect(googleAuthFetch(url)).rejects.toThrow("request rejected");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains upstream cancellation and forces no redirects, no caching and a deadline", async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal?.aborted).toBe(true);
      expect(init?.redirect).toBe("error"); expect(init?.cache).toBe("no-store");
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await (await googleAuthFetch("https://accounts.google.com", { signal: controller.signal })).json()).toEqual({ ok: true });
  });
  it("cancels oversized provider responses", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); }, cancel,
    }))));
    await expect(googleAuthFetch("https://accounts.google.com")).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
