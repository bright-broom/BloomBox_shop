import { devNull } from "node:os";
import { execFileSync } from "node:child_process";

// Fixed SQL only; no user-controlled text or identifiers are interpolated.
const inspection = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = 10000;
SELECT to_regclass('bloombox.schema_migrations') IS NOT NULL AS ledger_present \\gset
\\if :ledger_present
SELECT json_build_object('ledgerPresent', true, 'rows', COALESCE(json_agg(history), '[]'::json))
FROM (SELECT version, name, checksum FROM bloombox.schema_migrations ORDER BY version) history;
\\else
SELECT '{"ledgerPresent":false,"rows":[]}';
\\endif
ROLLBACK;
`;

export function psqlInspectionOptions({ databaseUrl, ssl }, environment = process.env) {
  const url = new URL(databaseUrl);
  // Never inherit service files, alternate hosts, startup options or password files.
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith("PG")));
  Object.assign(env, {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGPASSFILE: devNull,
    PGSSLMODE: ssl === false ? "disable" : "verify-full", PGGSSENCMODE: "disable", PGSSLCERTMODE: "disable",
    ...(ssl === false ? {} : { PGSSLROOTCERT: "system" }),
    PGCHANNELBINDING: url.searchParams.get("channel_binding") || "prefer", PGCONNECT_TIMEOUT: "10",
  });
  return { env, input: inspection, encoding: "utf8", timeout: 25000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] };
}

export function inspectWithPsql(config) {
  let output;
  try {
    output = execFileSync(config.psql, ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-f", "-"], psqlInspectionOptions(config));
  } catch (error) {
    const denied = /\b42501\b/.test(String(error.stderr));
    throw new Error(denied ? "INSPECTION_FORBIDDEN" : "INSPECTION_FAILED");
  }
  const report = JSON.parse(output);
  if (typeof report?.ledgerPresent !== "boolean" || !Array.isArray(report.rows)) throw new Error("INSPECTION_FAILED");
  return report;
}
