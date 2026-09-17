import { databaseStatusConfig, inspectDatabaseStatus } from "./lib/database-status.mjs";

try {
  const report = await inspectDatabaseStatus(databaseStatusConfig(process.env));
  console.log(JSON.stringify(report));
  if (report.status !== "current") process.exitCode = 1;
} catch (error) {
  const known = ["INSPECTION_FORBIDDEN", "INSPECTION_FAILED", "INVALID_CONFIGURATION", "INVALID_LOCAL_SEQUENCE", "MIGRATION_HISTORY_MISMATCH"];
  const code = known.includes(error.message) ? error.message : "INSPECTION_FAILED";
  // Connection errors may contain credentials, hostnames or database messages.
  console.error(`Database schema inspection: ${code}`);
  process.exitCode = 1;
}
