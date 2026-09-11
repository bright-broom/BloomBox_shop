import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionRevocationError, FulfillmentApprovalError } from "@/modules/fulfillment/public";
import { revokePermission } from "@/app/operations/permissions/actions";
const mocks = vi.hoisted(() => ({ revoke: vi.fn(), headers: vi.fn(), revalidate: vi.fn() }));
vi.mock("./operator-permissions", () => ({ revokeOperatorPermission: mocks.revoke }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
beforeEach(() => { vi.resetAllMocks(); mocks.headers.mockResolvedValue(new Headers({ origin: "https://operators.example" })); });
describe("permission action", () => {
  it("ignores caller outcome and refreshes only the fixed management path after success", async () => {
    mocks.revoke.mockResolvedValue({ outcome: "DUPLICATE", privateId: "hidden" });
    expect(await revokePermission({ status: "REVOKED" }, new FormData())).toEqual({ status: "DUPLICATE" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/operations/permissions");
  });
  it.each(["INVALID_REQUEST", "NOT_AUTHORIZED", "REVIEW_REQUIRED", "CONFLICT", "UNAVAILABLE"] as const)("translates %s without success or refresh", async (code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.revoke.mockRejectedValue(new PermissionRevocationError(code));
    expect(await revokePermission({ status: "REVOKED" }, new FormData())).toEqual({ status: code });
    expect(mocks.revalidate).not.toHaveBeenCalled(); log.mockRestore();
  });
  it("preserves rate-limit feedback and committed success despite refresh failure, with no raw logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.revoke.mockRejectedValueOnce(new FulfillmentApprovalError("RATE_LIMITED"));
    expect(await revokePermission({ status: "IDLE" }, new FormData())).toEqual({ status: "RATE_LIMITED" });
    mocks.revoke.mockRejectedValueOnce(new Error("PRIVATE_CONNECTION"));
    expect(await revokePermission({ status: "IDLE" }, new FormData())).toEqual({ status: "UNAVAILABLE" });
    mocks.revoke.mockResolvedValue({ outcome: "REVOKED" }); mocks.revalidate.mockImplementation(() => { throw new Error("PRIVATE_REFRESH"); });
    expect(await revokePermission({ status: "IDLE" }, new FormData())).toEqual({ status: "REVOKED" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE"); log.mockRestore();
  });
});
