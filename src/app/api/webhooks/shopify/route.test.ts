import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidProviderWebhookError } from "@/modules/payment/public";
const { execute, receiver, report } = vi.hoisted(() => ({ execute: vi.fn(), receiver: vi.fn(), report: vi.fn() }));
vi.mock("@/shared/infrastructure/composition-root", () => ({ getShopifyWebhookReceiver: receiver }));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({ reportUnexpectedError: report }));
import { POST } from "./route";
const headers = { "content-type": "application/json; charset=utf-8", "x-shopify-hmac-sha256": "signed", "x-shopify-shop-domain": "bloom.myshopify.com", "x-shopify-topic": "orders/paid", "x-shopify-api-version": "2026-07" };
function request(body: BodyInit = "{}", overrides: Record<string, string> = {}) {
  return new Request(new URL("shopify-webhook", import.meta.url), { method: "POST", headers: { ...headers, ...overrides }, body, ...{ duplex: "half" } });
}
describe("Shopify webhook route", () => {
  beforeEach(() => { vi.resetAllMocks(); receiver.mockReturnValue({ execute }); execute.mockResolvedValue("INSERTED"); });
  afterEach(() => vi.useRealTimers());
  it("keeps capture disabled without reading the body", async () => {
    receiver.mockReturnValue(null);
    expect((await POST(request())).status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    [{ "x-shopify-hmac-sha256": "" }, 400], [{ "x-shopify-shop-domain": "" }, 400],
    [{ "content-type": "text/plain" }, 415], [{ "content-length": "invalid" }, 400], [{ "content-length": "1000001" }, 413],
  ] as const)("rejects invalid headers before persistence: %j", async (override, status) => {
    expect((await POST(request("{}", override))).status).toBe(status);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(["INSERTED", "DUPLICATE", "IGNORED"])("acknowledges %s and preserves exact bytes", async (result) => {
    execute.mockResolvedValue(result);
    const raw = " {\"note\":\"花\"}\n";
    const response = await POST(request(raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: result === "DUPLICATE" });
    expect(execute).toHaveBeenCalledWith(Buffer.from(raw), { signature: "signed", shop: "bloom.myshopify.com", topic: "orders/paid", apiVersion: "2026-07" });
  });
  it("bounds actual streamed bytes even with a false length header", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(600_000)); }, cancel });
    expect((await POST(request(stream, { "content-length": "2" }))).status).toBe(413);
    expect(cancel).toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("times out a stalled body and cancels reading", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
    const pending = POST(request(new ReadableStream<Uint8Array>({ cancel })));
    await vi.advanceTimersByTimeAsync(2_001);
    expect((await pending).status).toBe(408);
    expect(cancel).toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("does not acknowledge invalid signatures or failed persistence", async () => {
    execute.mockRejectedValueOnce(new InvalidProviderWebhookError());
    expect((await POST(request())).status).toBe(400); expect(report).not.toHaveBeenCalled();
    execute.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ received: false });
    expect(report).toHaveBeenCalledWith(expect.any(Error), { operation: "receive_shopify_webhook" });
  });
  it("does not persist an interrupted stream", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("interrupted")); } });
    expect((await POST(request(stream))).status).toBe(500);
    expect(execute).not.toHaveBeenCalled();
  });
});
