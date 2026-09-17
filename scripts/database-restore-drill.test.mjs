import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { compareRestoreManifests, restoreDrillConfig, runRestoreDrill } from "./lib/database-restore-drill.mjs";

const settings = {
  RESTORE_DRILL_SOURCE_URL: "postgres://owner:synthetic-secret@127.0.0.1/source",
  RESTORE_DRILL_ADMIN_URL: "postgres://owner:synthetic-secret@127.0.0.1/postgres",
  RESTORE_DRILL_OUTPUT_DIRECTORY: "/tmp/bloombox-restore-test",
  RESTORE_DRILL_PG_DUMP: "/usr/bin/pg_dump", RESTORE_DRILL_PG_RESTORE: "/usr/bin/pg_restore",
};
describe("local restore drill safety", () => {
  it.each([
    { RESTORE_DRILL_SOURCE_URL: "postgres://private:secret@production.example/db" },
    { RESTORE_DRILL_ADMIN_URL: "postgres://private:secret@production.example/postgres" },
    { RESTORE_DRILL_ADMIN_URL: "postgres://private:secret@127.0.0.1/customer_local" },
    { RESTORE_DRILL_SOURCE_URL: "postgres://private:secret@127.0.0.1/db?host=production.example" },
    { RESTORE_DRILL_SOURCE_URL: "postgres://127.0.0.1/db" },
    { RESTORE_DRILL_SOURCE_URL: "file:///tmp/db" },
    { RESTORE_DRILL_PG_DUMP: "pg_dump" },
    { RESTORE_DRILL_PG_RESTORE: "" },
    { RESTORE_DRILL_OUTPUT_DIRECTORY: "" },
  ])("rejects unsafe configuration before opening a connection: %j", override => {
    expect(() => restoreDrillConfig({ ...settings, ...override })).toThrow("INVALID_CONFIGURATION");
  });
  it("compares contents as well as counts and migration rows", () => {
    const before = [{ table: "orders", rows: 2, digest: "before" }];
    expect(compareRestoreManifests(before, before)).toEqual({ tables: 1, rows: 2 });
    expect(() => compareRestoreManifests(before, [{ ...before[0], digest: "changed" }])).toThrow("CONTENT_MISMATCH");
    expect(() => compareRestoreManifests(before, [])).toThrow("CONTENT_MISMATCH");
  });
  it("fails without leaking secret environment values or command arguments", () => {
    const result = spawnSync(process.execPath, ["scripts/database-restore-drill.mjs", "synthetic-secret"], {
      env: settings, encoding: "utf8", timeout: 5000,
    });
    expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Database restore drill: INVALID_CONFIGURATION\n");
  });
});

// Opt-in: a disposable loopback PostgreSQL cluster, never a customer/source database.
const integration = process.env.TEST_RESTORE_DRILL_ADMIN_URL;
(integration ? describe : describe.skip)("actual PostgreSQL backup/restore rehearsal", () => {
  it("restores an exact snapshot, retains source data, isolates target, and rejects executable failures safely", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bloombox-restore-test-"));
    const config = restoreDrillConfig({ ...settings, RESTORE_DRILL_ADMIN_URL: integration,
      RESTORE_DRILL_SOURCE_URL: integration, RESTORE_DRILL_OUTPUT_DIRECTORY: directory,
      RESTORE_DRILL_PG_DUMP: process.env.TEST_PG_DUMP,
      RESTORE_DRILL_PG_RESTORE: process.env.TEST_PG_RESTORE });
    const admin = postgres(config.admin.toString(), { ssl: false, max: 1 });
    const name = `test_restore_source_${randomBytes(8).toString("hex")}`;
    let source, restored, failedTarget;
    try {
      await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE template0`);
      const url = new URL(config.admin); url.pathname = `/${name}`;
      source = postgres(url.toString(), { ssl: false, max: 1 });
      await source.unsafe(`CREATE SCHEMA bloombox;
        CREATE TABLE bloombox.schema_migrations(version text primary key, checksum text);
        INSERT INTO bloombox.schema_migrations VALUES('0001','synthetic-checksum');
        CREATE TABLE bloombox.orders(id uuid primary key, amount integer check(amount>=0), private_note text, ciphertext bytea);
        INSERT INTO bloombox.orders VALUES('11111111-1111-4111-8111-111111111111',5000,'never-report-this',decode('010203','hex'));
        CREATE TABLE bloombox.payments(order_id uuid references bloombox.orders(id), amount integer);
        INSERT INTO bloombox.payments VALUES('11111111-1111-4111-8111-111111111111',5000);`);
      const report = await runRestoreDrill({ ...config, source: url });
      expect(report).toMatchObject({ status: "verified", tables: 3, rows: 3 });
      expect(report.targetDatabase).not.toBe(name);
      expect((await stat(report.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(report.directory, "database.dump"))).mode & 0o777).toBe(0o600);
      const stored = await readFile(join(report.directory, "report.json"), "utf8");
      expect(stored).not.toMatch(/never-report-this|synthetic-secret|ciphertext|digest/);
      expect(await source`select count(*)::int as n from bloombox.orders`).toMatchObject([{ n: 1 }]);
      const target = new URL(config.admin); target.pathname = `/${report.targetDatabase}`;
      restored = postgres(target.toString(), { ssl: false, max: 1 });
      expect(await restored`select amount,private_note,encode(ciphertext,'hex') as bytes from bloombox.orders`).toMatchObject([{ amount: 5000, private_note: "never-report-this", bytes: "010203" }]);
      await expect(restored`insert into bloombox.payments values ('22222222-2222-4222-8222-222222222222',5)`).rejects.toMatchObject({ code: "23503" });
      const [acl] = await admin`select exists(select 1 from pg_database d,aclexplode(d.datacl) a where d.datname=${report.targetDatabase} and a.grantee=0) as public_access`;
      expect(acl.public_access).toBe(false);
      // A write after the manifest must not enter pg_dump's exported snapshot.
      const shellArgument = value => "'" + value.replaceAll("'", "'\\''") + "'";
      const concurrent = join(directory, "concurrent.sh");
      await writeFile(concurrent, `#!/bin/sh\nset -eu\n${shellArgument(join(dirname(config.pgDump), "psql"))} -X -w -v ON_ERROR_STOP=1 -c "INSERT INTO bloombox.payments VALUES ('11111111-1111-4111-8111-111111111111',7)" >/dev/null\nexec ${shellArgument(config.pgDump)} "$@"\n`);
      await chmod(concurrent, 0o700);
      const snapshot = await runRestoreDrill({ ...config, source: url, pgDump: concurrent });
      expect(snapshot.rows).toBe(3);
      expect(await source`select count(*)::int as n from bloombox.payments`).toMatchObject([{ n: 2 }]);
      const fail = join(directory, "fail.sh"); await writeFile(fail, "#!/bin/sh\necho never-report-this >&2\nexit 1\n"); await chmod(fail, 0o700);
      await expect(runRestoreDrill({ ...config, source: url, pgRestore: fail })).rejects.toThrow("POSTGRES_COMMAND_FAILED");
      expect(await source`select count(*)::int as n from bloombox.orders`).toMatchObject([{ n: 1 }]);
      // Force an actual COPY failure after schema creation, not merely a failed executable.
      await source.unsafe(`CREATE FUNCTION bloombox.restore_allowed(integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
        ALTER TABLE bloombox.orders ADD CONSTRAINT restore_allowed CHECK (bloombox.restore_allowed(amount));
        CREATE OR REPLACE FUNCTION bloombox.restore_allowed(integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false';`);
      const beforeFailure = new Set(await readdir(directory));
      await expect(runRestoreDrill({ ...config, source: url })).rejects.toThrow("POSTGRES_COMMAND_FAILED");
      const [failedDirectory] = (await readdir(directory)).filter(name => !beforeFailure.has(name));
      const failed = JSON.parse(await readFile(join(directory, failedDirectory, "report.json"), "utf8"));
      expect(failed.status).toBe("failed");
      const failedUrl = new URL(config.admin); failedUrl.pathname = `/${failed.targetDatabase}`;
      failedTarget = postgres(failedUrl.toString(), { ssl: false, max: 1 });
      expect(await failedTarget`SELECT to_regnamespace('bloombox') AS schema`).toMatchObject([{ schema: null }]);
      expect(await source`select count(*)::int as n from bloombox.orders`).toMatchObject([{ n: 1 }]);
      // Targets/archives remain isolated for inspection; the command never drops data on failure.
    } finally { await Promise.allSettled([admin.end(), source?.end(), restored?.end(), failedTarget?.end()]); }
  }, 30_000);
});
