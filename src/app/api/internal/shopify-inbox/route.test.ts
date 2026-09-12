import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), create: vi.fn(), execute: vi.fn(), report: vi.fn() }));
vi.mock("@/shared/infrastructure/config/shopify-inbox-config", () => ({ loadShopifyInboxConfig: mocks.load }));
vi.mock("@/shared/infrastructure/shopify-inbox-composition", () => ({ createShopifyInboxProcessor: mocks.create }));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({ reportUnexpectedError: mocks.report }));
import { POST } from "./route";
const config = { admin: { storeDomain: "test-shop.myshopify.com", accessToken: "synthetic-admin-token", apiVersion: "2026-07" },
  workerSecret: "synthetic-worker-secret-32-characters" };
const counts = { claimed: 1, processed: 1, retryScheduled: 0, failed: 0 };
function request(authorization?: string) {
  return new Request(new URL("shopify-inbox", import.meta.url), { method: "POST",
    headers: authorization ? { authorization } : {}, body: JSON.stringify({ shop: "forged-shop", live: true, approve: true }) });
}
describe("Shopify test inbox worker", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.load.mockReturnValue(config); mocks.create.mockReturnValue({ execute: mocks.execute }); mocks.execute.mockResolvedValue(counts); });
  it("stays disabled before constructing any database/provider adapters", async () => {
    mocks.load.mockReturnValue(null);
    const response = await POST(request());
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([undefined, "Bearer wrong", `Bearer ${config.workerSecret}extra`, config.workerSecret])("rejects invalid auth %s without I/O", async (authorization) => {
    expect((await POST(request(authorization))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("uses only server configuration and returns aggregate counts", async () => {
    const response = await POST(request(`Bearer ${config.workerSecret}`));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, inbox: counts });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(config); expect(mocks.execute).toHaveBeenCalledExactlyOnceWith();
  });
  it("reports scheduled retry separately from processing success", async () => {
    mocks.execute.mockResolvedValue({ ...counts, processed: 0, retryScheduled: 1 });
    const response = await POST(request(`Bearer ${config.workerSecret}`));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, inbox: { ...counts, processed: 0, retryScheduled: 1 } });
  });
  it("surfaces terminal failure", async () => {
    mocks.execute.mockResolvedValue({ ...counts, processed: 0, failed: 1 });
    const response = await POST(request(`Bearer ${config.workerSecret}`));
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ ok: false });
    expect(mocks.report.mock.calls[0][0].name).toBe("ShopifyInboxDeadLetterError");
  });
  it("does not disclose config or dependency errors", async () => {
    const error = new Error("synthetic secret"); mocks.load.mockImplementation(() => { throw error; });
    const response = await POST(request());
    expect(response.status).toBe(500); expect(await response.text()).not.toContain(error.message);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(error, { operation: "process_shopify_test_inbox" });
  });
});
