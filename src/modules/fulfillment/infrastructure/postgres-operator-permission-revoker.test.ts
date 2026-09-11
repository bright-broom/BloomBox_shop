import { afterAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { PostgresOperatorPermissionRevoker } from "./postgres-operator-permission-revoker";
import type { PermissionRevocationRequest } from "../application/revoke-operator-permission";

// No connection should be opened: invalid input and missing identity fail before begin().
const sql = postgres("postgres://127.0.0.1:1/test_no_connection");
const begin = vi.spyOn(sql, "begin");
afterAll(async () => { await sql.end(); });
const request: PermissionRevocationRequest = { shop: "example.myshopify.com",
  permissionId: "00000000-0000-4000-8000-000000000001", reviewedVersion: 1,
  idempotencyKey: "00000000-0000-4000-8000-000000000002", reason: "ROLE_CHANGE" };
describe("permission revocation input boundary", () => {
  it.each([{ operatorId: "caller-selected" }, { reason: "free text" }, { reviewedVersion: 0 },
    { reviewedVersion: Number.MAX_SAFE_INTEGER }, { shop: "https://example.com" }, { permissionId: "invalid" }])("rejects %j before reading identity or using storage", async (patch) => {
    const current = vi.fn(async () => null);
    await expect(new PostgresOperatorPermissionRevoker(sql, { current }).revoke(Object.assign({}, request, patch)))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(current).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled();
  });
  it("defaults to denied without a verified actor", async () => {
    await expect(new PostgresOperatorPermissionRevoker(sql).revoke(request)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(begin).not.toHaveBeenCalled();
  });
});
