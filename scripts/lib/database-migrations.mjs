import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const MIGRATION_LOCK_ID = 1_946_336_629;

export async function migrateDatabase({
  databaseUrl,
  migrationsDirectory = resolve(process.cwd(), "database/migrations"),
  ssl = "verify-full",
  onApplied = () => {},
}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for database migration");

  const migrations = await loadMigrations(migrationsDirectory);
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    ssl: normalizeSsl(ssl),
  });

  try {
    await sql`CREATE SCHEMA IF NOT EXISTS bloombox`;
    await sql`
      CREATE TABLE IF NOT EXISTS bloombox.schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum character(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `;

    for (const migration of migrations) {
      const wasApplied = await sql.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`;
        const appliedRows = await transaction`
          SELECT version, name, checksum
          FROM bloombox.schema_migrations
          WHERE version = ${migration.version}
        `;
        const applied = appliedRows[0];
        if (applied) {
          if (applied.checksum !== migration.checksum || applied.name !== migration.name) {
            throw new Error(`Applied migration ${migration.version} does not match its checked-in file`);
          }
          return true;
        }

        await transaction.unsafe(migration.contents);
        await transaction`
          INSERT INTO bloombox.schema_migrations (version, name, checksum)
          VALUES (${migration.version}, ${migration.name}, ${migration.checksum})
        `;
        return false;
      });
      if (!wasApplied) onApplied(migration);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function loadMigrations(migrationsDirectory) {
  const fileNames = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  const seenVersions = new Set();
  const migrations = [];
  for (const fileName of fileNames) {
    const match = MIGRATION_FILE_PATTERN.exec(fileName);
    if (!match) throw new Error(`Invalid migration file name: ${fileName}`);

    const [, version, name] = match;
    if (seenVersions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
    seenVersions.add(version);

    const contents = await readFile(resolve(migrationsDirectory, fileName), "utf8");
    if (!contents.trim()) throw new Error(`Migration is empty: ${fileName}`);
    migrations.push({
      version,
      name,
      fileName,
      contents,
      checksum: createHash("sha256").update(contents).digest("hex"),
    });
  }

  if (migrations.length === 0) throw new Error("No database migrations were found");
  return migrations;
}

function normalizeSsl(value) {
  if (value === "disable") return false;
  if (["require", "allow", "prefer", "verify-full"].includes(value)) return value;
  throw new Error(`Unsupported DATABASE_SSL_MODE: ${value}`);
}
