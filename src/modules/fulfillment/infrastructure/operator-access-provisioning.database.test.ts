import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { provisionOperatorAccess, type OperatorAccessProvisioningRequest } from "./operator-access-provisioning";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeUrl() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Local test database required");
  return databaseUrl;
}
const describeDatabase = databaseUrl ? describe : describe.skip;
describeDatabase("owner-only operator access provisioning", () => {
  const sql = postgres(safeUrl(), { max: 8, ssl: false });
  const database = new URL(safeUrl()).pathname.slice(1);
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let i = 0; i < 2; i++) execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await sql.end(); });
  function request(kind: OperatorAccessProvisioningRequest["kind"] = "APPROVER"): OperatorAccessProvisioningRequest {
    return { changeId: randomUUID(), database, kind, permissionId: randomUUID(), operatorId: randomUUID(),
      shop: "example.myshopify.com", expectedVersion: 0, enabled: true, validUntil: new Date(Date.now() + 600_000).toISOString(), reason: "INITIAL_ASSIGNMENT" };
  }
  async function apply(value: OperatorAccessProvisioningRequest) {
    const plan = await provisionOperatorAccess(sql, value);
    return provisionOperatorAccess(sql, value, plan.planHash);
  }
  it.each(["APPROVER", "PERMISSION_MANAGER"] as const)("plans without writes, creates %s once and records before/after audit", async (kind) => {
    const value = request(kind);
    const table = kind === "APPROVER" ? "fulfillment_operator_permissions" : "fulfillment_permission_managers";
    const plan = await provisionOperatorAccess(sql, value);
    expect(plan).toMatchObject({ outcome: "PLAN", before: null, proposed: { enabled: true, version: 1 } });
    expect(await sql`SELECT * FROM bloombox.${sql(table)} WHERE id = ${value.permissionId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${value.permissionId}`).toHaveLength(0);
    expect(await provisionOperatorAccess(sql, value)).toEqual(plan);
    const results = await Promise.all(Array.from({ length: 6 }, () => provisionOperatorAccess(sql, value, plan.planHash)));
    expect(results.filter((r) => r.outcome === "APPLIED")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "DUPLICATE")).toHaveLength(5);
    const [row] = await sql`SELECT * FROM bloombox.${sql(table)} WHERE id = ${value.permissionId}`;
    expect(Number(row.version)).toBe(1);
    const audits = await sql`SELECT * FROM bloombox.audit_logs WHERE resource_id = ${value.permissionId}`;
    expect(audits).toHaveLength(2);
    expect(audits.find((r) => r.id === value.changeId)).toMatchObject({ actor_type: "SYSTEM", actor_reference: "operator-access-provisioning",
      safe_metadata: { request: value, before: null, after: { enabled: true, version: 1 }, planHash: plan.planHash } });
    expect(await sql`SELECT id FROM bloombox.outbox_events`).toHaveLength(0);
  });
  it("updates expiry, disables and re-enables only the reviewed version; an old retry cannot undo later changes", async () => {
    const original = request(); await apply(original);
    const renewal = { ...original, changeId: randomUUID(), expectedVersion: 1, reason: "ACCESS_RENEWAL" as const,
      validUntil: new Date(Date.now() + 1_200_000).toISOString() };
    expect(await apply(renewal)).toMatchObject({ outcome: "APPLIED", current: { version: 2, validUntil: renewal.validUntil } });
    const disable = { ...renewal, changeId: randomUUID(), expectedVersion: 2, enabled: false, reason: "SECURITY_RESPONSE" as const };
    const plan = await provisionOperatorAccess(sql, disable);
    await provisionOperatorAccess(sql, disable, plan.planHash);
    await apply({ ...renewal, changeId: randomUUID(), expectedVersion: 3 });
    await expect(provisionOperatorAccess(sql, disable, plan.planHash)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect((await sql`SELECT enabled, version FROM bloombox.fulfillment_operator_permissions WHERE id = ${original.permissionId}`)[0])
      .toMatchObject({ enabled: true, version: "4" });
  });
  it("rejects stale plans, altered requests, ID/scope substitution and shared change keys", async () => {
    const value = request(); const plan = await provisionOperatorAccess(sql, value);
    await expect(provisionOperatorAccess(sql, { ...value, enabled: false }, plan.planHash)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    await expect(provisionOperatorAccess(sql, value, "0".repeat(64))).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    await apply(value);
    for (const override of [{ reason: "ROLE_CHANGE" }, { kind: "PERMISSION_MANAGER" }, { permissionId: randomUUID() }, { shop: "other.myshopify.com" }]) {
      await expect(provisionOperatorAccess(sql, { ...value, ...override }, plan.planHash)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    await expect(provisionOperatorAccess(sql, { ...value, changeId: randomUUID() })).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    const update = { ...value, changeId: randomUUID(), expectedVersion: 1, enabled: false };
    const stale = await provisionOperatorAccess(sql, update);
    await apply({ ...update, changeId: randomUUID() });
    await expect(provisionOperatorAccess(sql, update, stale.planHash)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  });
  it.each(["bloombox_application", "bloombox_worker", "bloombox_readonly", "bloombox_fulfillment_approver", "bloombox_permission_manager"])
    ("denies %s even with a valid owner-generated plan", async (role) => {
      const value = request(); const plan = await provisionOperatorAccess(sql, value);
      const restricted = postgres(safeUrl(), { max: 1, ssl: false, connection: { role } });
      try {
        await expect(provisionOperatorAccess(restricted, value)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
        await expect(provisionOperatorAccess(restricted, value, plan.planHash)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
      } finally { await restricted.end(); }
    });
  it("rejects the wrong database, expired grants and malformed inputs", async () => {
    const value = request();
    await expect(provisionOperatorAccess(sql, { ...value, database: "another_test" })).rejects.toMatchObject({ code: "WRONG_DATABASE" });
    await expect(provisionOperatorAccess(sql, { ...value, validUntil: new Date(0).toISOString() })).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    for (const changed of [{ ...value, email: "private@example.com" }, { ...value, expectedVersion: -1 }, { ...value, kind: "ADMIN" }, { ...value, reason: "private free text" }]) {
      await expect(provisionOperatorAccess(sql, changed)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
  });
  it("rolls back the change and trigger audit if operation audit fails, then safely retries", async () => {
    const value = request(); const plan = await provisionOperatorAccess(sql, value);
    await sql.unsafe(`CREATE FUNCTION bloombox.test_provisioning_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'fulfillment.operator_access.provisioned' THEN RAISE EXCEPTION 'Synthetic failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_provisioning_audit_failure BEFORE INSERT ON bloombox.audit_logs FOR EACH ROW EXECUTE FUNCTION bloombox.test_provisioning_audit_failure()`);
    try { await expect(provisionOperatorAccess(sql, value, plan.planHash)).rejects.toMatchObject({ code: "UNAVAILABLE" }); }
    finally { await sql.unsafe("DROP TRIGGER test_provisioning_audit_failure ON bloombox.audit_logs; DROP FUNCTION bloombox.test_provisioning_audit_failure()"); }
    expect(await sql`SELECT id FROM bloombox.fulfillment_operator_permissions WHERE id = ${value.permissionId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${value.permissionId}`).toHaveLength(0);
    expect(await provisionOperatorAccess(sql, value, plan.planHash)).toMatchObject({ outcome: "APPLIED" });
  });
  it("rechecks the version after an observed row-lock wait", async () => {
    const value = request(); await apply(value);
    const update = { ...value, changeId: randomUUID(), expectedVersion: 1, enabled: false };
    const plan = await provisionOperatorAccess(sql, update);
    const waiting = postgres(safeUrl(), { max: 1, ssl: false });
    let pending: Promise<unknown> = Promise.resolve();
    try {
      const [{ pid }] = await waiting`SELECT pg_backend_pid() AS pid`;
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM bloombox.fulfillment_operator_permissions WHERE id = ${value.permissionId} FOR UPDATE`;
        pending = provisionOperatorAccess(waiting, update, plan.planHash).then(() => "allowed", (error: unknown) => error);
        await vi.waitFor(async () => { expect((await sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`)[0].wait_event_type).toBe("Lock"); }, { timeout: 500, interval: 10 });
        await tx`UPDATE bloombox.fulfillment_operator_permissions SET version = version + 1, updated_at = clock_timestamp() WHERE id = ${value.permissionId}`;
      });
      expect(await pending).toMatchObject({ code: "REVIEW_REQUIRED" });
      expect(await sql`SELECT id FROM bloombox.audit_logs WHERE id = ${update.changeId}`).toHaveLength(0);
    } finally { await pending; await waiting.end(); }
  });
  it("executes the actual offline CLI as plan, apply and retry without changing credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bloombox-provisioning-test-")); const file = join(directory, "request.json");
    const value = request("PERMISSION_MANAGER"); await writeFile(file, JSON.stringify(value), { mode: 0o600 });
    const run = (args: string[]) => promisify(execFile)(process.execPath, ["scripts/provision-operator-access.mjs", file, ...args],
      { env: { ...process.env, DATABASE_OPERATOR_ADMIN_URL: databaseUrl, DATABASE_SSL_MODE: "disable" } });
    try {
      const plan = JSON.parse((await run([])).stdout); expect(plan.outcome).toBe("PLAN");
      expect(JSON.parse((await run([`--apply=${plan.planHash}`])).stdout).outcome).toBe("APPLIED");
      expect(JSON.parse((await run([`--apply=${plan.planHash}`])).stdout).outcome).toBe("DUPLICATE");
    } finally { await rm(directory, { recursive: true }); }
  });
  it("does not allow competing creation plans to overwrite each other", async () => {
    const first = request(), second = { ...first, changeId: randomUUID(), reason: "ROLE_CHANGE" as const };
    const a = await provisionOperatorAccess(sql, first), b = await provisionOperatorAccess(sql, second);
    const results = await Promise.allSettled([provisionOperatorAccess(sql, first, a.planHash), provisionOperatorAccess(sql, second, b.planHash)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${first.permissionId}`).toHaveLength(2);
  });
  it("rejects an expiry crossed during a lock wait", async () => {
    const value = request(); await apply(value);
    const update = { ...value, changeId: randomUUID(), expectedVersion: 1, validUntil: new Date(Date.now() + 400).toISOString() };
    const plan = await provisionOperatorAccess(sql, update);
    const waiting = postgres(safeUrl(), { max: 1, ssl: false });
    let pending: Promise<unknown> = Promise.resolve();
    try {
      const [{ pid }] = await waiting`SELECT pg_backend_pid() AS pid`;
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM bloombox.fulfillment_operator_permissions WHERE id = ${value.permissionId} FOR SHARE`;
        pending = provisionOperatorAccess(waiting, update, plan.planHash).then(() => "allowed", (error: unknown) => error);
        await vi.waitFor(async () => { expect((await sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`)[0].wait_event_type).toBe("Lock"); }, { timeout: 500, interval: 10 });
        await tx`SELECT pg_sleep(greatest(0, extract(epoch FROM (${update.validUntil}::timestamptz - clock_timestamp()))) + 0.03)`;
      });
      expect(await pending).toMatchObject({ code: "REVIEW_REQUIRED" });
      expect(await sql`SELECT id FROM bloombox.audit_logs WHERE id = ${update.changeId}`).toHaveLength(0);
    } finally { await pending; await waiting.end(); }
  });
  it("rolls back if the grant expires during the final audit write", async () => {
    const value = { ...request(), validUntil: new Date(Date.now() + 500).toISOString() };
    const plan = await provisionOperatorAccess(sql, value);
    await sql.unsafe(`CREATE FUNCTION bloombox.test_provisioning_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'fulfillment.operator_access.provisioned' THEN PERFORM pg_sleep(0.7); END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_provisioning_delay BEFORE INSERT ON bloombox.audit_logs FOR EACH ROW EXECUTE FUNCTION bloombox.test_provisioning_delay()`);
    const started = Date.now();
    try { await expect(provisionOperatorAccess(sql, value, plan.planHash)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" }); }
    finally { await sql.unsafe("DROP TRIGGER test_provisioning_delay ON bloombox.audit_logs; DROP FUNCTION bloombox.test_provisioning_delay()"); }
    expect(Date.now() - started).toBeGreaterThanOrEqual(650);
    expect(await sql`SELECT id FROM bloombox.fulfillment_operator_permissions WHERE id = ${value.permissionId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${value.permissionId}`).toHaveLength(0);
  });
  it("protects provisioning receipts from runtime writers and preserves unrelated audit insertion", async () => {
    for (const role of ["bloombox_application", "bloombox_worker", "bloombox_fulfillment_approver", "bloombox_permission_manager"]) {
      const restricted = postgres(safeUrl(), { max: 1, ssl: false, connection: { role } });
      try {
        await expect(restricted`INSERT INTO bloombox.audit_logs (id, actor_type, actor_reference, action, resource_type, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'SYSTEM', 'operator-access-provisioning', 'fulfillment.operator_access.provisioned', 'FulfillmentPermission', '{}', clock_timestamp())`)
          .rejects.toMatchObject({ code: "42501" });
        await restricted`INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'SYSTEM', 'synthetic.unrelated.audit', 'Test', '{}', clock_timestamp())`;
      } finally { await restricted.end(); }
    }
    const value = request(); await apply(value);
    await expect(sql`DELETE FROM bloombox.audit_logs WHERE id = ${value.changeId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE bloombox.audit_logs SET action = 'changed' WHERE id = ${value.changeId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE bloombox.audit_logs SET action = 'fulfillment.operator_access.provisioned' WHERE action = 'synthetic.unrelated.audit'`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, safe_metadata, occurred_at)
      VALUES (${randomUUID()}, 'OPERATOR', 'fulfillment.operator_access.provisioned', 'FulfillmentPermission', '{}', clock_timestamp())`).rejects.toMatchObject({ code: "23514" });
  });
  it("fails closed before planning or applying when the audit protection is absent or disabled", async () => {
    const value = request(); const plan = await provisionOperatorAccess(sql, value);
    await sql.unsafe("ALTER TABLE bloombox.audit_logs DISABLE TRIGGER operator_provisioning_audit_protected");
    try {
      await expect(provisionOperatorAccess(sql, value)).rejects.toMatchObject({ code: "UNAVAILABLE" });
      await expect(provisionOperatorAccess(sql, value, plan.planHash)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    } finally { await sql.unsafe("ALTER TABLE bloombox.audit_logs ENABLE TRIGGER operator_provisioning_audit_protected"); }
    await sql.unsafe("ALTER TRIGGER operator_provisioning_audit_protected ON bloombox.audit_logs RENAME TO test_missing_guard");
    try { await expect(provisionOperatorAccess(sql, value)).rejects.toMatchObject({ code: "UNAVAILABLE" }); }
    finally { await sql.unsafe("ALTER TRIGGER test_missing_guard ON bloombox.audit_logs RENAME TO operator_provisioning_audit_protected"); }
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${value.permissionId}`).toHaveLength(0);
  });
});
