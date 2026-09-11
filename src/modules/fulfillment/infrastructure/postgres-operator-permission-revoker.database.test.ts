import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PermissionRevocationError, type PermissionRevocationRequest } from "../application/revoke-operator-permission";
import { PostgresOperatorPermissionRevoker } from "./postgres-operator-permission-revoker";
import { PostgresFulfillmentReviewQuery } from "./postgres-fulfillment-review-query";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeUrl() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Local test database required");
  return databaseUrl;
}
const describeDatabase = databaseUrl ? describe : describe.skip;
const shop = "example.myshopify.com";
describeDatabase("audited operator permission revocation", () => {
  const sql = postgres(safeUrl(), { max: 3, ssl: false });
  const managerSql = postgres(safeUrl(), { max: 4, ssl: false, connection: { role: "bloombox_permission_manager" } });
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let i = 0; i < 2; i++) execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await managerSql.end(); await sql.end(); });
  async function fixture() {
    const managerId = randomUUID(); const actorId = randomUUID(); const targetId = randomUUID(); const permissionId = randomUUID();
    const expiresAt = new Date(Date.now() + 600_000);
    await sql`INSERT INTO bloombox.fulfillment_permission_managers (id, operator_id, provider_scope, enabled, valid_until, created_at, updated_at)
      VALUES (${managerId}, ${actorId}, ${shop}, true, ${expiresAt}, clock_timestamp() - interval '1 minute', clock_timestamp())`;
    await sql`INSERT INTO bloombox.fulfillment_operator_permissions (id, operator_id, provider_scope, enabled, valid_until, created_at, updated_at)
      VALUES (${permissionId}, ${targetId}, ${shop}, true, ${expiresAt}, clock_timestamp() - interval '1 minute', clock_timestamp())`;
    const identity = { current: async () => ({ operatorId: actorId, expiresAt }) };
    const request: PermissionRevocationRequest = { shop, permissionId, reviewedVersion: 1, reason: "ROLE_CHANGE", idempotencyKey: randomUUID() };
    return { managerId, actorId, targetId, permissionId, expiresAt, identity, request, revoker: new PostgresOperatorPermissionRevoker(managerSql, identity) };
  }
  async function permission(id: string) {
    const [row] = await sql`SELECT enabled, version FROM bloombox.fulfillment_operator_permissions WHERE id = ${id}`;
    return { enabled: row.enabled, version: Number(row.version) };
  }
  it("records six concurrent retries once, with actor/reason audit and no shipment effect", async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 6 }, () => f.revoker.revoke(f.request)));
    expect(results.filter((r) => r.outcome === "REVOKED")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "DUPLICATE")).toHaveLength(5);
    expect(new Set(results.map((r) => r.revocationId)).size).toBe(1);
    expect(await permission(f.permissionId)).toEqual({ enabled: false, version: 2 });
    expect(await sql`SELECT id FROM bloombox.fulfillment_permission_revocations WHERE permission_id = ${f.permissionId}`).toHaveLength(1);
    const audit = await sql`SELECT actor_type, actor_reference, safe_metadata FROM bloombox.audit_logs
      WHERE resource_id = ${f.permissionId} AND action = 'fulfillment.operator_permission.revoked'`;
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ actor_type: "OPERATOR", actor_reference: f.actorId,
      safe_metadata: { reason: "ROLE_CHANGE", previousVersion: 1, version: 2, managerId: f.managerId, managerVersion: 1 } });
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${f.permissionId} AND actor_type = 'SYSTEM'`).toHaveLength(2);
    expect(await sql`SELECT id FROM bloombox.outbox_events`).toHaveLength(0);
  });
  it.each(["missing", "disabled", "expired", "future", "session", "shop"] as const)("rejects %s management authority", async (condition) => {
    const f = await fixture();
    let identity = f.identity; let request = f.request;
    if (condition === "missing") identity = { current: async () => ({ operatorId: f.targetId, expiresAt: f.expiresAt }) };
    if (condition === "disabled") await sql`UPDATE bloombox.fulfillment_permission_managers SET enabled = false, version = version + 1 WHERE id = ${f.managerId}`;
    if (condition === "expired") await sql`UPDATE bloombox.fulfillment_permission_managers SET valid_until = clock_timestamp() - interval '1 second', version = version + 1 WHERE id = ${f.managerId}`;
    if (condition === "future") {
      const newActor = randomUUID(); identity = { current: async () => ({ operatorId: newActor, expiresAt: f.expiresAt }) };
      await sql`INSERT INTO bloombox.fulfillment_permission_managers (id, operator_id, provider_scope, enabled, valid_until, created_at, updated_at)
        VALUES (${randomUUID()}, ${newActor}, ${shop}, true, ${f.expiresAt}, clock_timestamp() + interval '1 minute', clock_timestamp())`;
    }
    if (condition === "session") identity = { current: async () => ({ operatorId: f.actorId, expiresAt: new Date(0) }) };
    if (condition === "shop") request = { ...request, shop: "other.myshopify.com" };
    await expect(new PostgresOperatorPermissionRevoker(managerSql, identity).revoke(request)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(await permission(f.permissionId)).toEqual({ enabled: true, version: 1 });
  });
  it("rejects a mismatched target, stale review and already disabled permission", async () => {
    const f = await fixture();
    await expect(f.revoker.revoke({ ...f.request, permissionId: randomUUID() })).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    await expect(f.revoker.revoke({ ...f.request, reviewedVersion: 2 })).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    await sql`UPDATE bloombox.fulfillment_operator_permissions SET enabled = false, version = version + 1 WHERE id = ${f.permissionId}`;
    await expect(f.revoker.revoke({ ...f.request, reviewedVersion: 2 })).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(await sql`SELECT id FROM bloombox.fulfillment_permission_revocations WHERE permission_id = ${f.permissionId}`).toHaveLength(0);
  });
  it("rejects changed replay intent and never revokes a later re-enabled version implicitly", async () => {
    const f = await fixture(); await f.revoker.revoke(f.request);
    for (const patch of [{ reason: "SECURITY_RESPONSE" as const }, { idempotencyKey: randomUUID() }]) {
      await expect(f.revoker.revoke({ ...f.request, ...patch })).rejects.toMatchObject({ code: "CONFLICT" });
    }
    await sql`UPDATE bloombox.fulfillment_operator_permissions SET enabled = true, version = version + 1 WHERE id = ${f.permissionId}`;
    await expect(f.revoker.revoke(f.request)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(await permission(f.permissionId)).toEqual({ enabled: true, version: 3 });
    expect(await f.revoker.revoke({ ...f.request, reviewedVersion: 3, idempotencyKey: randomUUID() })).toMatchObject({ outcome: "REVOKED", version: 4 });
  });
  it("reauthorizes replay and rejects a re-provisioned manager's old authorization revision", async () => {
    const f = await fixture(); await f.revoker.revoke(f.request);
    await sql`UPDATE bloombox.fulfillment_permission_managers SET enabled = false, version = version + 1 WHERE id = ${f.managerId}`;
    await expect(f.revoker.revoke(f.request)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await sql`UPDATE bloombox.fulfillment_permission_managers SET enabled = true, version = version + 1 WHERE id = ${f.managerId}`;
    await expect(f.revoker.revoke(f.request)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("does not mix a valid manager scope with another shop's permission", async () => {
    const f = await fixture(); const otherShop = "other.myshopify.com";
    await sql`INSERT INTO bloombox.fulfillment_permission_managers (id, operator_id, provider_scope, enabled, valid_until, created_at, updated_at)
      VALUES (${randomUUID()}, ${f.actorId}, ${otherShop}, true, ${f.expiresAt}, clock_timestamp(), clock_timestamp())`;
    await expect(f.revoker.revoke({ ...f.request, shop: otherShop })).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(await permission(f.permissionId)).toEqual({ enabled: true, version: 1 });
  });
  it("rejects competing keys and reuse of a successful key against another target", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([f.revoker.revoke(f.request), f.revoker.revoke({ ...f.request, idempotencyKey: randomUUID() })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    if (rejected?.status !== "rejected") throw new Error("Expected competing key rejection");
    expect(rejected.reason).toEqual(new PermissionRevocationError("CONFLICT"));
    const [receipt] = await sql`SELECT idempotency_key FROM bloombox.fulfillment_permission_revocations WHERE permission_id = ${f.permissionId}`;
    const newPermission = randomUUID();
    await sql`INSERT INTO bloombox.fulfillment_operator_permissions (id, operator_id, provider_scope, enabled, valid_until, created_at, updated_at)
      VALUES (${newPermission}, ${randomUUID()}, ${shop}, true, ${f.expiresAt}, clock_timestamp(), clock_timestamp())`;
    await expect(f.revoker.revoke({ ...f.request, permissionId: newPermission, idempotencyKey: receipt.idempotency_key }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await permission(newPermission)).toEqual({ enabled: true, version: 1 });
  });
  it("rolls back the disabled flag, revision, receipt and SYSTEM audit if actor audit fails", async () => {
    const f = await fixture();
    await sql`REVOKE INSERT ON bloombox.audit_logs FROM bloombox_permission_manager`;
    try { await expect(f.revoker.revoke(f.request)).rejects.toEqual(new PermissionRevocationError("UNAVAILABLE")); }
    finally { await sql`GRANT INSERT ON bloombox.audit_logs TO bloombox_permission_manager`; }
    expect(await permission(f.permissionId)).toEqual({ enabled: true, version: 1 });
    expect(await sql`SELECT id FROM bloombox.fulfillment_permission_revocations WHERE permission_id = ${f.permissionId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${f.permissionId}`).toHaveLength(1);
    expect(await f.revoker.revoke(f.request)).toMatchObject({ outcome: "REVOKED", version: 2 });
  });
  it("allows only disabling through the narrow function and protects manager/receipt history", async () => {
    const f = await fixture();
    await expect(managerSql`UPDATE bloombox.fulfillment_operator_permissions SET enabled = true WHERE id = ${f.permissionId}`).rejects.toMatchObject({ code: "42501" });
    await expect(managerSql`UPDATE bloombox.fulfillment_operator_permissions SET valid_until = clock_timestamp() + interval '1 year' WHERE id = ${f.permissionId}`).rejects.toMatchObject({ code: "42501" });
    await expect(managerSql`UPDATE bloombox.fulfillment_permission_managers SET enabled = true WHERE id = ${f.managerId}`).rejects.toMatchObject({ code: "42501" });
    await expect(managerSql`DELETE FROM bloombox.fulfillment_permission_managers WHERE id = ${f.managerId}`).rejects.toMatchObject({ code: "42501" });
    for (const role of ["bloombox_application", "bloombox_worker", "bloombox_readonly", "bloombox_fulfillment_approver"]) {
      const restricted = postgres(safeUrl(), { max: 1, ssl: false, connection: { role } });
      try { await expect(restricted`SELECT * FROM bloombox.disable_fulfillment_permission(${f.permissionId}::uuid, 1::bigint)`).rejects.toMatchObject({ code: "42501" }); }
      finally { await restricted.end(); }
    }
    const [{ proconfig }] = await sql`SELECT proconfig FROM pg_proc WHERE oid = 'bloombox.disable_fulfillment_permission(uuid,bigint)'::regprocedure`;
    expect(proconfig).toContain("search_path=pg_catalog, pg_temp");
    expect(await managerSql`SELECT * FROM bloombox.disable_fulfillment_permission(${f.permissionId}::uuid, 999::bigint)`).toHaveLength(0);
    const receipt = await f.revoker.revoke(f.request);
    expect(await managerSql`SELECT * FROM bloombox.disable_fulfillment_permission(${f.permissionId}::uuid, 2::bigint)`).toHaveLength(0);
    await expect(sql`UPDATE bloombox.fulfillment_permission_revocations SET reason = 'SECURITY_RESPONSE' WHERE id = ${receipt.revocationId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM bloombox.fulfillment_permission_revocations WHERE id = ${receipt.revocationId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE bloombox.fulfillment_permission_managers SET operator_id = ${randomUUID()}, version = version + 1 WHERE id = ${f.managerId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM bloombox.fulfillment_permission_managers WHERE id = ${f.managerId}`).rejects.toMatchObject({ code: "23514" });
  });
  it("takes effect in the existing operator review authorization immediately", async () => {
    const f = await fixture();
    const operator = postgres(safeUrl(), { max: 1, ssl: false, connection: { role: "bloombox_fulfillment_approver" } });
    try {
      const query = new PostgresFulfillmentReviewQuery(operator, true, { current: async () => ({ operatorId: f.targetId, expiresAt: f.expiresAt }) });
      const target = { shop, fulfillmentId: randomUUID() };
      expect(await query.find(target)).toBeNull();
      await f.revoker.revoke(f.request);
      await expect(query.find(target)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    } finally { await operator.end(); }
  });
  it("stops on a bounded target-lock timeout without making a partial change", async () => {
    const f = await fixture();
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM bloombox.fulfillment_operator_permissions WHERE id = ${f.permissionId} FOR SHARE`;
      await expect(f.revoker.revoke(f.request)).rejects.toEqual(new PermissionRevocationError("UNAVAILABLE"));
    });
    expect(await permission(f.permissionId)).toEqual({ enabled: true, version: 1 });
    expect(await sql`SELECT id FROM bloombox.fulfillment_permission_revocations WHERE permission_id = ${f.permissionId}`).toHaveLength(0);
    expect(await f.revoker.revoke(f.request)).toMatchObject({ outcome: "REVOKED" });
  });
  it.each(["manager", "permission", "session"] as const)("rechecks %s after an observed lock wait", async (changed) => {
    const f = await fixture();
    const waiting = postgres(safeUrl(), { max: 1, ssl: false, connection: { role: "bloombox_permission_manager" } });
    let pending: Promise<unknown> = Promise.resolve();
    try {
      const [{ pid }] = await waiting`SELECT pg_backend_pid() AS pid`;
      await sql.begin(async (tx) => {
        if (changed === "manager") await tx`SELECT id FROM bloombox.fulfillment_permission_managers WHERE id = ${f.managerId} FOR UPDATE`;
        else await tx`SELECT id FROM bloombox.fulfillment_operator_permissions WHERE id = ${f.permissionId} FOR SHARE`;
        const identity = changed === "session" ? { current: async () => ({ operatorId: f.actorId, expiresAt: new Date(Date.now() + 200) }) } : f.identity;
        pending = new PostgresOperatorPermissionRevoker(waiting, identity).revoke(f.request).then(() => "allowed", (error: unknown) => error);
        await vi.waitFor(async () => {
          expect((await sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`)[0].wait_event_type).toBe("Lock");
        }, { timeout: 500, interval: 10 });
        if (changed === "manager") await tx`UPDATE bloombox.fulfillment_permission_managers SET enabled = false, version = version + 1 WHERE id = ${f.managerId}`;
        else if (changed === "permission") await tx`UPDATE bloombox.fulfillment_operator_permissions SET enabled = false, version = version + 1 WHERE id = ${f.permissionId}`;
        else await tx`SELECT pg_sleep(0.3)`;
      });
      expect(await pending).toEqual(new PermissionRevocationError(changed === "permission" ? "REVIEW_REQUIRED" : "NOT_AUTHORIZED"));
      expect(await sql`SELECT id FROM bloombox.fulfillment_permission_revocations WHERE permission_id = ${f.permissionId}`).toHaveLength(0);
    } finally { await pending; await waiting.end(); }
  });
});
