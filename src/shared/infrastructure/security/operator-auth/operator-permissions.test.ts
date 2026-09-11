import { beforeEach, describe, expect, it, vi } from "vitest";
import { FulfillmentApprovalError, PermissionRevocationError } from "@/modules/fulfillment/public";
import { preparePermissionManagement, revokeOperatorPermission } from "./operator-permissions";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn(), list: vi.fn(), revoke: vi.fn(), consume: vi.fn() }));
vi.mock("./operator-auth", () => ({ getOperatorAuth: mocks.auth }));
vi.mock("../../database/database-connections", () => ({ getPermissionManagerDatabaseClient: mocks.database }));
vi.mock("@/modules/fulfillment/infrastructure/postgres-operator-permission-query", () => ({ PostgresOperatorPermissionQuery: class { list = mocks.list; } }));
vi.mock("@/modules/fulfillment/infrastructure/postgres-operator-permission-revoker", () => ({ PostgresOperatorPermissionRevoker: class { revoke = mocks.revoke; } }));
vi.mock("@/modules/fulfillment/infrastructure/postgres-approval-submission-limiter", () => ({ PostgresApprovalSubmissionLimiter: class { consume = mocks.consume; } }));
const origin = "https://operators.example"; const operatorId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002"; const shop = "example.myshopify.com";
beforeEach(() => {
  vi.resetAllMocks(); const expires = new Date(Date.now() + 600_000).toISOString();
  mocks.auth.mockReturnValue({ config: { origin, secret: "synthetic-management-intent-secret", bindings: [{ subject: "12345", operatorId }], testMode: true },
    auth: { auth: async () => ({ user: { id: "12345" }, expires }) } });
  mocks.list.mockResolvedValue({ shop, viewedAt: new Date().toISOString(), nextCursor: null,
    entries: [{ id: targetId, operatorId: "00000000-0000-4000-8000-000000000003", enabled: true, version: 7, validUntil: expires, latestRevocation: null }] });
  mocks.revoke.mockResolvedValue({ outcome: "REVOKED", privateReceipt: "not-for-browser" });
});
function form(intent: string) { const value = new FormData(); value.set("intent", intent); value.set("reason", "ROLE_CHANGE"); value.set("acknowledged", "yes"); return value; }
async function prepared() { const page = await preparePermissionManagement({ shop }); const token = page.entries[0].intent; if (!token) throw new Error("Missing context"); return token; }
describe("permission management composition", () => {
  it("submits the encrypted reviewed target, shared allowance and original retry key", async () => {
    const submitted = form(await prepared());
    expect(await revokeOperatorPermission(submitted, origin)).toEqual({ outcome: "REVOKED" });
    expect(mocks.revoke.mock.calls[0][0]).toMatchObject({ shop, permissionId: targetId, reviewedVersion: 7, reason: "ROLE_CHANGE" });
    await revokeOperatorPermission(submitted, origin);
    expect(mocks.consume).toHaveBeenCalledTimes(2); expect(mocks.revoke.mock.calls[0][0]).toEqual(mocks.revoke.mock.calls[1][0]);
    expect(mocks.consume.mock.invocationCallOrder[0]).toBeLessThan(mocks.revoke.mock.invocationCallOrder[0]);
  });
  it("does not issue forms for already disabled permissions", async () => {
    const page = await mocks.list(); page.entries[0].enabled = false;
    mocks.list.mockResolvedValue(page);
    expect((await preparePermissionManagement({})).entries[0].intent).toBeNull();
  });
  it("refuses missing login, binding and wrong Origin before any database use", async () => {
    await expect(revokeOperatorPermission(form("forged"), null)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(revokeOperatorPermission(form("forged"), "https://other.example")).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    const service = mocks.auth(); service.config.bindings = [];
    await expect(preparePermissionManagement({})).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(revokeOperatorPermission(form("forged"), origin)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    mocks.auth.mockReturnValue(null);
    await expect(preparePermissionManagement({})).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("rejects extra identity/target, duplicate values, free text and missing acknowledgement", async () => {
    for (const mutate of [(v: FormData) => v.set("operatorId", operatorId), (v: FormData) => v.set("permissionId", targetId),
      (v: FormData) => v.append("intent", "other"), (v: FormData) => v.append("reason", "ROLE_CHANGE"),
      (v: FormData) => v.set("reason", "private free text"), (v: FormData) => v.delete("acknowledged")]) {
      const value = form("forged"); mutate(value);
      await expect(revokeOperatorPermission(value, origin)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it.each(["RATE_LIMITED", "UNAVAILABLE"] as const)("does not proceed through %s", async (code) => {
    mocks.consume.mockRejectedValue(new FulfillmentApprovalError(code));
    await expect(revokeOperatorPermission(form(await prepared()), origin)).rejects.toMatchObject({ code });
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("consumes allowance for tampered contexts and reauthorizes at the command boundary", async () => {
    await expect(revokeOperatorPermission(form("forged"), origin)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(mocks.consume).toHaveBeenCalledTimes(1); expect(mocks.revoke).not.toHaveBeenCalled();
    mocks.revoke.mockRejectedValue(new PermissionRevocationError("NOT_AUTHORIZED"));
    await expect(revokeOperatorPermission(form(await prepared()), origin)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});
