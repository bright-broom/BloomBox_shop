import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
function testDatabase() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test") || url.search) {
    throw new Error("Isolated local test database required");
  }
  return databaseUrl;
}
(databaseUrl ? describe : describe.skip)("migration history reader privileges", () => {
  const sql = postgres(testDatabase(), { ssl: false, max: 1, prepare: false, onnotice: () => {} });
  const role = `test_schema_reader_${randomUUID().replaceAll("-", "")}`;
  let source: string;
  async function apply() {
    try { await sql.unsafe(source); }
    catch (error) { await sql`ROLLBACK`; throw error; }
  }
  async function asReader(query: string) {
    const connection = await sql.reserve();
    try {
      await connection.unsafe(`SET ROLE ${role}`);
      return await connection.unsafe(query);
    } finally { await connection`RESET ROLE`; connection.release(); }
  }
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync(process.execPath, ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    source = (await readFile("database/schema-reader.sql", "utf8"))
      .replace(/^\\set ON_ERROR_STOP on$/m, "").replaceAll("bloombox_schema_reader", role);
  });
  afterAll(async () => {
    await sql`ROLLBACK`;
    const [exists] = await sql`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${role}) AS present`;
    if (exists.present) {
      await sql.unsafe(`DROP OWNED BY ${role}`);
      await sql.unsafe(`DROP ROLE ${role}`);
    }
    await sql.end({ timeout: 5 });
  });
  it("grants only the three history columns and can be reapplied", async () => {
    await apply(); await apply();
    const rows = await asReader("SELECT version,name,checksum FROM bloombox.schema_migrations ORDER BY version");
    const expected = await sql`SELECT version,name,checksum FROM bloombox.schema_migrations ORDER BY version`;
    expect(expected.length).toBeGreaterThan(0);
    expect(rows).toEqual(expected);
    expect(await sql`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=${role}`)
      .toEqual([{ rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolinherit: false }]);
  });
  it.each([
    "SELECT * FROM bloombox.schema_migrations",
    "SELECT * FROM bloombox.customer_accounts",
    "SELECT * FROM bloombox.orders",
    "UPDATE bloombox.schema_migrations SET name=name WHERE false",
    "DELETE FROM bloombox.schema_migrations WHERE false",
    "CREATE TABLE bloombox.unexpected_reader_table(id integer)",
  ])("rejects broader reads and writes: %s", async (query) => {
    await expect(asReader(query)).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects login/privilege drift without silently changing existing grants", async () => {
    await sql.unsafe(`ALTER ROLE ${role} LOGIN`);
    await expect(apply()).rejects.toThrow("unexpected attributes");
    await sql.unsafe(`ALTER ROLE ${role} NOLOGIN`);
    await sql.unsafe(`GRANT SELECT ON bloombox.orders TO ${role}`);
    await expect(apply()).rejects.toThrow("unexpected object privileges");
    const [drift] = await sql`SELECT has_table_privilege(${role}, 'bloombox.orders', 'SELECT') AS retained`;
    expect(drift.retained).toBe(true);
    await sql.unsafe(`REVOKE SELECT ON bloombox.orders FROM ${role}`);
    await apply();
  });
  it("does not create a role or initialize a missing ledger", async () => {
    const absentRole = role + "_absent";
    await sql`ALTER TABLE bloombox.schema_migrations RENAME TO saved_schema_migrations`;
    try {
      await expect(sql.unsafe(source.replaceAll(role, absentRole))).rejects.toThrow("Migration ledger is required");
      await sql`ROLLBACK`;
      expect(await sql`SELECT count(*)::integer AS count FROM pg_roles WHERE rolname=${absentRole}`).toEqual([{ count: 0 }]);
      expect(await sql`SELECT to_regclass('bloombox.schema_migrations') AS ledger`).toEqual([{ ledger: null }]);
    } finally {
      await sql`ROLLBACK`;
      await sql`ALTER TABLE bloombox.saved_schema_migrations RENAME TO schema_migrations`;
    }
  });
});
