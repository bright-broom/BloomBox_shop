import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountPortalError,
  emptyAccountPreferences,
} from "@/modules/customer/public";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  read: vi.fn(),
  requests: vi.fn(),
}));
vi.mock("../customer-portal", () => ({ customerPortalContext: mocks.context }));
import { GET } from "@/app/account/export/route";
const actor = {
  customerId: "00000000-0000-4000-8000-000000000001",
  version: 1,
  expiresAt: Date.now() + 60000,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({
    actor,
    repository: { read: mocks.read, requests: mocks.requests },
  });
  mocks.read.mockResolvedValue({
    revision: 1,
    preferences: emptyAccountPreferences(),
  });
  mocks.requests.mockResolvedValue([]);
});
describe("customer export HTTP boundary", () => {
  it("downloads only the authenticated account and prevents caching or indexing", async () => {
    const response = await GET(
      new Request("https://shop.example/account/export"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "attachment;",
    );
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(mocks.read).toHaveBeenCalledWith(actor);
    expect(mocks.requests).toHaveBeenCalledWith(actor);
    expect(await response.json()).toMatchObject({
      format: "bloombox-account-v1",
      profile: emptyAccountPreferences(),
      requests: [],
    });
  });
  it("rejects cross-site downloads before accessing a session or database", async () => {
    const response = await GET(
      new Request("https://shop.example/account/export", {
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it("returns no account data after expiration or storage failure", async () => {
    for (const code of ["expired", "unavailable"] as const) {
      mocks.context.mockRejectedValueOnce(new AccountPortalError(code));
      const response = await GET(
        new Request("https://shop.example/account/export"),
      );
      expect(response.status).toBe(code === "expired" ? 401 : 503);
      expect(await response.json()).toEqual({
        error: "Account export unavailable",
      });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});
