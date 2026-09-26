import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { ContractingMigrationError, contractingStatements, loadMigrations, migrateDatabase } from "./lib/database-migrations.mjs";

describe("expand-only migration check", () => {
  it.each([
    ["DROP TABLE bloombox.old;", "DROP"],
    ["ALTER TABLE bloombox.t DROP COLUMN note;", "DROP"],
    ["ALTER TABLE bloombox.t RENAME COLUMN a TO b;", "RENAME"],
    ["ALTER TABLE bloombox.t ALTER COLUMN amount TYPE bigint;", "ALTER COLUMN TYPE"],
    ["ALTER TABLE bloombox.t ALTER COLUMN amount SET NOT NULL;", "SET NOT NULL"],
    ["TRUNCATE bloombox.t;", "TRUNCATE"],
    ["DELETE FROM bloombox.t WHERE true;", "DELETE"],
    ["REVOKE SELECT ON bloombox.orders FROM bloombox_worker;", "REVOKE"],
    ["REVOKE ALL ON bloombox.orders FROM PUBLIC;", "REVOKE"],
  ])("flags what can break the version still serving traffic: %s", (sql, label) => {
    expect(contractingStatements(sql)).toContain(label);
  });

  it("allows additive changes, backfills, comments and hardening of objects the migration creates", () => {
    expect(contractingStatements(`
      -- DROP TABLE mentioned only in a comment
      /* RENAME in a block comment */
      CREATE TABLE IF NOT EXISTS bloombox.new_things (id uuid PRIMARY KEY, note text);
      REVOKE ALL ON bloombox.new_things FROM PUBLIC;
      CREATE FUNCTION bloombox.lock_it(uuid) RETURNS void LANGUAGE sql AS 'SELECT 1';
      REVOKE ALL ON FUNCTION bloombox.lock_it(uuid) FROM PUBLIC;
      ALTER TABLE bloombox.orders ADD COLUMN gift_note text;
      CREATE INDEX orders_gift_note ON bloombox.orders (gift_note);
      UPDATE bloombox.orders SET gift_note = '' WHERE gift_note IS NULL;
      GRANT SELECT ON bloombox.new_things TO bloombox_worker;
    `)).toEqual([]);
  });

  it("keeps every migration not yet recorded on the public database expand-only", async () => {
    // The public database was recorded through 0027; everything after it will be applied automatically.
    const pending = (await loadMigrations("database/migrations")).filter((migration) => migration.version > "0027");
    expect(pending.map((migration) => [migration.fileName, contractingStatements(migration.contents)]))
      .toEqual(pending.map((migration) => [migration.fileName, []]));
  });
});

const admin = process.env.TEST_RESTORE_DRILL_ADMIN_URL;
(admin ? describe : describe.skip)("expand-only migration against PostgreSQL", () => {
  it("refuses a pending contracting migration before applying anything, and applies additive ones", async () => {
    const adminUrl = new URL(admin);
    if (adminUrl.pathname !== "/postgres") throw new Error("Use a disposable loopback admin database");
    const name = `test_expand_${randomBytes(6).toString("hex")}`;
    const root = postgres(admin, { ssl: false, max: 1 });
    const directory = await mkdtemp(join(tmpdir(), "bloombox-expand-"));
    const url = new URL(adminUrl); url.pathname = `/${name}`;
    let db;
    try {
      await root.unsafe(`CREATE DATABASE ${name} TEMPLATE template0`);
      db = postgres(url.toString(), { ssl: false, max: 1 });
      await writeFile(join(directory, "0001_first.sql"), "CREATE TABLE bloombox.items (id integer PRIMARY KEY, note text);");
      await migrateDatabase({ databaseUrl: url.toString(), ssl: "disable", migrationsDirectory: directory, expandOnly: true });
      await writeFile(join(directory, "0002_add.sql"), "ALTER TABLE bloombox.items ADD COLUMN extra text;");
      await writeFile(join(directory, "0003_drop.sql"), "ALTER TABLE bloombox.items DROP COLUMN note;");
      await expect(migrateDatabase({ databaseUrl: url.toString(), ssl: "disable", migrationsDirectory: directory, expandOnly: true }))
        .rejects.toBeInstanceOf(ContractingMigrationError);
      // Nothing from the batch was applied, not even the additive 0002 that precedes the refused file.
      expect((await db`SELECT version FROM bloombox.schema_migrations ORDER BY version`).map((row) => row.version)).toEqual(["0001"]);
      await rm(join(directory, "0003_drop.sql"));
      await migrateDatabase({ databaseUrl: url.toString(), ssl: "disable", migrationsDirectory: directory, expandOnly: true });
      expect((await db`SELECT version FROM bloombox.schema_migrations ORDER BY version`).map((row) => row.version)).toEqual(["0001", "0002"]);
    } finally {
      if (db) await db.end();
      await root.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await root.end();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
