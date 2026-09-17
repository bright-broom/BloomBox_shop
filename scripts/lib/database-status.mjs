import postgres from "postgres";
import { inspectWithPsql } from "./database-status-psql.mjs";
import { resolve, isAbsolute } from "node:path";
import { loadMigrations } from "./database-migrations.mjs";

export function databaseStatusConfig(env) {
  try {
    const url = new URL(env.DATABASE_STATUS_URL);
    const psql = env.DATABASE_STATUS_PSQL;
    if (psql !== undefined && !isAbsolute(psql)) throw new Error();
    for (const [key, value] of url.searchParams) {
      if (!psql || url.searchParams.getAll(key).length !== 1
        || !((key === "sslmode" && ["require", "verify-full"].includes(value))
          || (key === "channel_binding" && value === "require"))) throw new Error();
    }
    const mode = env.DATABASE_STATUS_SSL_MODE ?? "verify-full";
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username
      || url.pathname.length < 2 || url.hash
      || !["verify-full", "disable"].includes(mode)
      || (mode === "disable" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error();
    if (mode === "disable" && url.search) throw new Error();
    return { psql, databaseUrl: url.toString(), ssl: mode === "disable" ? false : "verify-full" };
  } catch { throw new Error("INVALID_CONFIGURATION"); }
}

export function compareMigrationHistory(migrations, applied) {
  for (let i = 0; i < migrations.length; i++) {
    if (migrations[i].version !== String(i + 1).padStart(4, "0")) throw new Error("INVALID_LOCAL_SEQUENCE");
  }
  // Applied history must be an exact prefix, not merely a matching row count.
  const rows = [...applied].sort((a, b) => String(a.version).localeCompare(String(b.version)));
  for (let i = 0; i < rows.length; i++) {
    const expected = migrations[i], actual = rows[i];
    if (!expected || actual.version !== expected.version || actual.name !== expected.name
      || actual.checksum !== expected.checksum) throw new Error("MIGRATION_HISTORY_MISMATCH");
  }
  const pending = migrations.slice(rows.length).map(({ fileName }) => fileName);
  return { status: pending.length ? "pending" : "current", applied: rows.length, total: migrations.length, pending };
}

export async function inspectDatabaseStatus({ databaseUrl, ssl, psql, migrationsDirectory = resolve(process.cwd(), "database/migrations") }) {
  const migrations = await loadMigrations(migrationsDirectory);
  compareMigrationHistory(migrations, []);
  if (psql) {
    const { rows, ledgerPresent } = inspectWithPsql({ databaseUrl, ssl, psql });
    return { ...compareMigrationHistory(migrations, rows), ledgerPresent };
  }
  const sql = postgres(databaseUrl, {
    max: 1, prepare: false, ssl, connect_timeout: 10, onnotice: () => {},
    connection: { application_name: "bloombox-schema-status" },
  });
  try {
    return await sql.begin("isolation level repeatable read read only", async (tx) => {
      await tx`SET LOCAL statement_timeout = 10000`;
      const [ledger] = await tx`SELECT to_regclass('bloombox.schema_migrations') IS NOT NULL AS present`;
      const applied = ledger.present ? await tx`SELECT version, name, checksum FROM bloombox.schema_migrations ORDER BY version` : [];
      return { ...compareMigrationHistory(migrations, applied), ledgerPresent: ledger.present };
    });
  } catch (error) {
    if (error.code === "42501") throw new Error("INSPECTION_FORBIDDEN");
    throw error;
  } finally { await sql.end({ timeout: 5 }); }
}
