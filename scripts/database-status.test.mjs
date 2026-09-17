import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { databaseStatusConfig, compareMigrationHistory, inspectDatabaseStatus } from "./lib/database-status.mjs";
import { loadMigrations, migrateDatabase } from "./lib/database-migrations.mjs";

const migrations = [1, 2].map((i) => ({ version: `000${i}`, name: `step_${i}`, checksum: `${i}`.repeat(64), fileName: `000${i}_step_${i}.sql` }));
describe("read-only migration preflight", () => {
  it("reports a matching prefix and exact pending files", () => {
    expect(compareMigrationHistory(migrations, [])).toMatchObject({ status: "pending", applied: 0, pending: migrations.map((m) => m.fileName) });
    expect(compareMigrationHistory(migrations, migrations.slice(0, 1))).toMatchObject({ status: "pending", applied: 1, pending: [migrations[1].fileName] });
    expect(compareMigrationHistory(migrations, [...migrations].reverse())).toMatchObject({ status: "current", applied: 2, pending: [] });
  });
  it.each([
    [migrations[1]], [migrations[0], migrations[0]],
    [{ ...migrations[0], name: "changed" }], [{ ...migrations[0], checksum: "changed" }],
    [...migrations, { version: "0003" }], [{ version: "private-untrusted-value" }],
  ])("rejects gaps, duplicates, future versions and altered history", (...rows) => {
    expect(() => compareMigrationHistory(migrations, rows)).toThrow("MIGRATION_HISTORY_MISMATCH");
  });
  it("rejects a noncontiguous local sequence", () => {
    expect(() => compareMigrationHistory([migrations[1]], [])).toThrow("INVALID_LOCAL_SEQUENCE");
  });
  it.each([
    {}, { DATABASE_STATUS_URL: "postgres://private:secret@host/db?sslmode=disable" },
    { DATABASE_STATUS_URL: "https://private:secret@host/db" },
    { DATABASE_STATUS_URL: "postgres://private:secret@host/db", DATABASE_STATUS_SSL_MODE: "disable" },
    { DATABASE_STATUS_URL: "postgres://private:secret@host/db", DATABASE_STATUS_SSL_MODE: "require" },
  ])("rejects ambiguous or insecure connections", (env) => {
    expect(() => databaseStatusConfig(env)).toThrow("INVALID_CONFIGURATION");
  });
  it("uses verified TLS remotely and permits explicit loopback test connections", () => {
    expect(databaseStatusConfig({ DATABASE_STATUS_URL: "postgres://reader:secret@db.example/db" }).ssl).toBe("verify-full");
    expect(databaseStatusConfig({ DATABASE_STATUS_URL: "postgres://reader:secret@127.0.0.1/db", DATABASE_STATUS_SSL_MODE: "disable" }).ssl).toBe(false);
  });
  it("does not expose credentials in CLI configuration errors", () => {
    const result = spawnSync(process.execPath, ["scripts/database-status.mjs"], { encoding: "utf8",
      env: { DATABASE_STATUS_URL: "https://reader:synthetic-secret@private-host/db" }, timeout: 5000 });
    expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Database schema inspection: INVALID_CONFIGURATION\n");
  });
});

const integration = process.env.TEST_RESTORE_DRILL_ADMIN_URL;
(integration ? describe : describe.skip)("isolated PostgreSQL schema inspection", () => {
  it("does not initialize or change the DB and works with a SELECT-only role", async () => {
    const config = databaseStatusConfig({ DATABASE_STATUS_URL: integration, DATABASE_STATUS_SSL_MODE: "disable" });
    const adminUrl = new URL(config.databaseUrl);
    if (adminUrl.pathname !== "/postgres") throw new Error("Use a disposable loopback admin database");
    const suffix = randomBytes(8).toString("hex"), name = `test_status_${suffix}`, role = `status_reader_${suffix}`;
    const admin = postgres(config.databaseUrl, { ssl: false, max: 1 });
    const directory = await mkdtemp(join(tmpdir(), "bloombox-status-"));
    let db;
    try {
      await writeFile(join(directory, "0001_first.sql"), "CREATE TABLE bloombox.status_sentinel(id integer PRIMARY KEY); INSERT INTO bloombox.status_sentinel VALUES(1);");
      await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE template0`);
      const url = new URL(adminUrl); url.pathname = `/${name}`;
      db = postgres(url.toString(), { ssl: false, max: 1 });
      const inspect = () => inspectDatabaseStatus({ databaseUrl: url.toString(), ssl: false, migrationsDirectory: directory });
      expect(await inspect()).toMatchObject({ status: "pending", applied: 0, ledgerPresent: false });
      const pendingCli = spawnSync(process.execPath, ["scripts/database-status.mjs"], { encoding: "utf8", timeout: 15000,
        env: { DATABASE_STATUS_URL: url.toString(), DATABASE_STATUS_SSL_MODE: "disable" } });
      expect(pendingCli.status).toBe(1);
      expect(JSON.parse(pendingCli.stdout)).toMatchObject({ status: "pending", applied: 0, ledgerPresent: false });
      expect(pendingCli.stderr).toBe("");
      expect(await db`SELECT to_regnamespace('bloombox') IS NULL AS absent`).toMatchObject([{ absent: true }]);
      await migrateDatabase({ databaseUrl: url.toString(), ssl: "disable", migrationsDirectory: directory });
      const before = await db`SELECT * FROM bloombox.schema_migrations`;
      expect(await inspect()).toMatchObject({ status: "current", applied: 1 });
      await writeFile(join(directory, "0002_second.sql"), "ALTER TABLE bloombox.status_sentinel ADD COLUMN untouched boolean;");
      expect(await inspect()).toMatchObject({ status: "pending", pending: ["0002_second.sql"] });
      expect(await db`SELECT * FROM bloombox.schema_migrations`).toEqual(before);
      expect(await db`SELECT * FROM bloombox.status_sentinel`).toEqual([{ id: 1 }]);
      await admin.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${suffix}'`);
      await db.unsafe(`GRANT USAGE ON SCHEMA bloombox TO ${role}; GRANT SELECT ON bloombox.schema_migrations TO ${role}`);
      const reader = new URL(url); reader.username = role; reader.password = suffix;
      expect(await inspectDatabaseStatus({ databaseUrl: reader.toString(), ssl: false, migrationsDirectory: directory })).toMatchObject({ status: "pending", applied: 1 });
      await db`UPDATE bloombox.schema_migrations SET checksum = ${"0".repeat(64)}`;
      await expect(inspect()).rejects.toThrow("MIGRATION_HISTORY_MISMATCH");
      const mismatchCli = spawnSync(process.execPath, ["scripts/database-status.mjs"], { encoding: "utf8", timeout: 15000,
        env: { DATABASE_STATUS_URL: url.toString(), DATABASE_STATUS_SSL_MODE: "disable" } });
      expect(mismatchCli.status).toBe(1); expect(mismatchCli.stdout).toBe("");
      expect(mismatchCli.stderr).toBe("Database schema inspection: MIGRATION_HISTORY_MISMATCH\n");
      expect((await loadMigrations(directory)).length).toBe(2);
    } finally {
      if (db) await db.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.unsafe(`DROP ROLE IF EXISTS ${role}`);
      await admin.end(); await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
