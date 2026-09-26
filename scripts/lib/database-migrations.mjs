import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const MIGRATION_LOCK_ID = 1_946_336_629;

/**
 * Statements that can break the application version still serving traffic while a new one deploys: they remove or
 * rename what old code reads, tighten what it writes, delete data, or withdraw privileges. Automatic deployment
 * applies migrations before the new code is live, so it only runs migrations free of these (expand-only).
 */
const CONTRACTING_STATEMENTS = [
  ["DROP", /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|TYPE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|SEQUENCE|TRIGGER|POLICY)\b/i],
  ["RENAME", /\bRENAME\b/i],
  ["ALTER COLUMN TYPE", /\bALTER\s+(?:COLUMN\s+)?"?[a-z_][a-z0-9_]*"?\s+(?:SET\s+DATA\s+)?TYPE\b/i],
  ["SET NOT NULL", /\bSET\s+NOT\s+NULL\b/i],
  ["TRUNCATE", /\bTRUNCATE\b/i],
  ["DELETE", /\bDELETE\s+FROM\b/i],
  ["REVOKE", /\bREVOKE\b/i],
];

// New functions are executable by PUBLIC by default; withdrawing that in the same migration hardens new code only.
const FUNCTION_PUBLIC_REVOKE = /\bREVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+[^;]+?\s+FROM\s+PUBLIC\s*;/gi;

const TABLE_PUBLIC_REVOKE = /\bREVOKE\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+(?:TABLE\s+)?([a-z_][a-z0-9_.]*)\s+FROM\s+PUBLIC\s*;/gi;

/** Labels of contracting statements in a migration, ignoring SQL comments. */
export function contractingStatements(contents) {
  const withoutComments = contents.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const created = new Set([...withoutComments.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_.]*)/gi)]
    .map((match) => match[1].toLowerCase()));
  // Locking down a table this same migration creates cannot affect code that never saw it.
  const code = withoutComments.replace(FUNCTION_PUBLIC_REVOKE, " ")
    .replace(TABLE_PUBLIC_REVOKE, (statement, table) => (created.has(table.toLowerCase()) ? " " : statement));
  return CONTRACTING_STATEMENTS.filter(([, pattern]) => pattern.test(code)).map(([label]) => label);
}

export class ContractingMigrationError extends Error {
  constructor(findings) {
    super(`Expand-only migration refused before applying anything: ${findings
      .map(({ fileName, labels }) => `${fileName} (${labels.join(", ")})`).join("; ")}. Use the manual Production Release.`);
    this.name = "ContractingMigrationError";
    this.findings = findings;
  }
}

export async function migrateDatabase({
  databaseUrl,
  migrationsDirectory = resolve(process.cwd(), "database/migrations"),
  ssl = "verify-full",
  onApplied = () => {},
  expandOnly = false,
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

    if (expandOnly) {
      // Check every pending migration before applying any, so a refusal never leaves a half-migrated schema.
      const applied = new Set((await sql`SELECT version FROM bloombox.schema_migrations`).map((row) => row.version));
      const findings = migrations
        .filter((migration) => !applied.has(migration.version))
        .map((migration) => ({ fileName: migration.fileName, labels: contractingStatements(migration.contents) }))
        .filter((finding) => finding.labels.length > 0);
      if (findings.length > 0) throw new ContractingMigrationError(findings);
    }

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
