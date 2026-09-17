import { beforeEach, describe, expect, it, vi } from "vitest";
const { execute, authorize } = vi.hoisted(() => ({ execute: vi.fn(), authorize: vi.fn() }));
vi.mock("@/shared/infrastructure/composition-root", () => ({ getCommerceBacklog: () => ({ execute }) }));
vi.mock("@/shared/infrastructure/security/worker-authorization", () => ({ isAuthorizedCommerceWorkerRequest: authorize }));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({ reportUnexpectedError: vi.fn() }));
import { GET } from "./route";
const request = (query = "") => new Request(new URL(`backlog${query}`, import.meta.url));
describe("protected commerce backlog endpoint", () => {
  beforeEach(() => { vi.resetAllMocks(); authorize.mockReturnValue(true); execute.mockResolvedValue({ inbox: {}, outbox: {} }); });
  it("requires worker authentication", async () => { authorize.mockReturnValue(false); expect((await GET(request())).status).toBe(401); expect(execute).not.toHaveBeenCalled(); });
  it.each(["?after=ffffffff-ffff-ffff-ffff-fffffffffff0", "?after=bad", "?account=other", "?after=&after=", "?after=00000000-0000-0000-0000-000000000000&payload=true"])("rejects invalid cursor/filter", async (query) => {
    expect((await GET(request(query))).status).toBe(400); expect(execute).not.toHaveBeenCalled();
  });
  it("returns no-store metadata page", async () => { const response = await GET(request()); expect(response.headers.get("cache-control")).toBe("no-store"); expect(execute).toHaveBeenCalledWith(undefined); });
});
