import { beforeEach, describe, expect, it, vi } from "vitest";
const { execute, authorize, report } = vi.hoisted(() => ({ execute: vi.fn(), authorize: vi.fn(), report: vi.fn() }));
vi.mock("@/shared/infrastructure/composition-root", () => ({ getStripeInboxRecovery: () => ({ execute }) }));
vi.mock("@/shared/infrastructure/security/worker-authorization", () => ({ isAuthorizedCommerceWorkerRequest: authorize }));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({ reportUnexpectedError: report }));
import { POST } from "./route";
const body = { externalEventId: "evt_syntheticRecovery001", incidentIssue: 137, requestedBy: "synthetic-operator" };
const request = (value: unknown = body) => new Request(new URL("restore", import.meta.url), { method: "POST", body: JSON.stringify(value) });
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
