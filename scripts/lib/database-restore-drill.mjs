import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import postgres from "postgres";

const execute = promisify(execFile);
const MAX_TABLES = 200;
const MAX_ROWS_PER_TABLE = 100_000;
export class RestoreDrillError extends Error {
  constructor(code) { super(`Database restore drill: ${code}`); this.code = code; }
}

// This rehearsal deliberately cannot target a remote database or overwrite an existing one.
export function restoreDrillConfig(env) {
  const parse = (value) => {
    try {
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol)
        || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        || !url.username || !/^\/[a-zA-Z0-9_]+$/.test(url.pathname)
        || url.search || url.hash) throw new Error();
      return url;
    } catch { throw new RestoreDrillError("INVALID_CONFIGURATION"); }
  };
  const source = parse(env.RESTORE_DRILL_SOURCE_URL);
  const admin = parse(env.RESTORE_DRILL_ADMIN_URL);
  if (admin.pathname !== "/postgres" || !env.RESTORE_DRILL_OUTPUT_DIRECTORY
    || !env.RESTORE_DRILL_PG_DUMP || !env.RESTORE_DRILL_PG_RESTORE
    || !env.RESTORE_DRILL_PG_DUMP.startsWith("/") || !env.RESTORE_DRILL_PG_RESTORE.startsWith("/")) {
    throw new RestoreDrillError("INVALID_CONFIGURATION");
  }
  return { source, admin, directory: resolve(env.RESTORE_DRILL_OUTPUT_DIRECTORY),
    pgDump: env.RESTORE_DRILL_PG_DUMP, pgRestore: env.RESTORE_DRILL_PG_RESTORE };
}

function processEnvironment(url) {
  // Do not inherit PGSERVICE/PGOPTIONS/PGHOSTADDR or auth secrets from the shell.
  return { PATH: "/usr/bin:/bin", LANG: "C", PGHOST: url.hostname === "[::1]" ? "::1" : url.hostname,
    PGPORT: url.port || "5432", PGDATABASE: url.pathname.slice(1),
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: "disable", PGCONNECT_TIMEOUT: "5", PGAPPNAME: "bloombox-restore-drill" };
}
async function command(binary, args, url) {
  try {
    await execute(binary, args, { env: processEnvironment(url), timeout: 180_000,
      maxBuffer: 256 * 1024, killSignal: "SIGKILL" });
  } catch { throw new RestoreDrillError("POSTGRES_COMMAND_FAILED"); }
}
function connect(url) {
  return postgres(url.toString(), { ssl: false, max: 1, connect_timeout: 5, prepare: false,
    onnotice: () => {}, connection: { application_name: "bloombox-restore-drill", statement_timeout: 180_000 } });
}
async function manifest(tx) {
  await tx`SET LOCAL timezone = 'UTC'`;
  await tx`SET LOCAL datestyle = 'ISO, YMD'`;
  const tables = await tx`SELECT tablename FROM pg_tables WHERE schemaname = 'bloombox' ORDER BY tablename`;
  if (!tables.length || tables.length > MAX_TABLES || !tables.some(t => t.tablename === "schema_migrations")) {
    throw new RestoreDrillError("UNSUPPORTED_SCHEMA");
  }
  const result = [];
  for (const { tablename } of tables) {
    let rows = 0;
    const hash = createHash("sha256");
    // Compare full logical contents, including encrypted bytes, without emitting a single row.
    await tx`SELECT to_jsonb(r)::text AS row FROM bloombox.${tx(tablename)} r
      ORDER BY to_jsonb(r)::text COLLATE "C"`.cursor(100, (batch) => {
      for (const record of batch) {
        if (++rows > MAX_ROWS_PER_TABLE) throw new RestoreDrillError("ROW_LIMIT_EXCEEDED");
        hash.update(record.row); hash.update("\n");
      }
    });
    result.push({ table: tablename, rows, digest: hash.digest("hex") });
  }
  return result;
}
export function compareRestoreManifests(source, restored) {
  if (JSON.stringify(source) !== JSON.stringify(restored)) throw new RestoreDrillError("CONTENT_MISMATCH");
  return { tables: source.length, rows: source.reduce((sum, table) => sum + table.rows, 0) };
}

export async function runRestoreDrill(config) {
  const started = Date.now();
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(config.directory, "restore-"));
  await chmod(directory, 0o700);
  const archive = join(directory, "database.dump");
  const reportPath = join(directory, "report.json");
  const name = `test_bloombox_restore_${Date.now()}_${randomBytes(6).toString("hex")}`;
  const target = new URL(config.admin); target.pathname = `/${name}`;
  const sourceSql = connect(config.source), adminSql = connect(config.admin);
  let targetSql, targetCreated = false;
  try {
    // Retain one read-only snapshot for both the manifest and pg_dump. No runtime worker is started.
    const source = await sourceSql.begin("isolation level repeatable read read only", async tx => {
      const [{ snapshot }] = await tx`SELECT pg_export_snapshot() AS snapshot`;
      const sourceManifest = await manifest(tx);
      await command(config.pgDump, ["--format=custom", "--schema=bloombox", "--no-owner", "--no-privileges",
        "--no-password", `--snapshot=${snapshot}`, `--file=${archive}`], config.source);
      return sourceManifest;
    });
    await chmod(archive, 0o600);
    // A generated name + CREATE DATABASE (no IF NOT EXISTS) never adopts a pre-existing target.
    await adminSql.unsafe(`CREATE DATABASE ${name} TEMPLATE template0`);
    targetCreated = true;
    await adminSql.unsafe(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
    await command(config.pgRestore, ["--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges",
      "--no-password", `--dbname=${name}`, archive], target);
    targetSql = connect(target);
    const restored = await targetSql.begin("isolation level repeatable read read only", manifest);
    const totals = compareRestoreManifests(source, restored);
    const report = { status: "verified", scope: "local-schema-data-only", ...totals,
      targetDatabase: name, durationMs: Date.now() - started,
      verifiedAt: new Date().toISOString(),
      excluded: ["production-recovery", "roles-and-grants", "decryption-keys", "provider-replay", "mail-delivery"] };
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    return { ...report, directory };
  } catch (error) {
    const code = error instanceof RestoreDrillError ? error.code : "UNAVAILABLE";
    // No subprocess stderr, query, connection string, row, ciphertext or per-table digest in reports.
    await writeFile(reportPath, JSON.stringify({ status: "failed", code, targetDatabase: targetCreated ? name : null }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    throw new RestoreDrillError(code);
  } finally {
    await Promise.allSettled([sourceSql.end({ timeout: 5 }), adminSql.end({ timeout: 5 }), targetSql?.end({ timeout: 5 })]);
  }
}
