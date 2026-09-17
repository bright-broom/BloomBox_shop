import { restoreDrillConfig, runRestoreDrill, RestoreDrillError } from "./lib/database-restore-drill.mjs";

try {
  if (process.argv.length !== 2) throw new RestoreDrillError("INVALID_CONFIGURATION");
  console.log(JSON.stringify(await runRestoreDrill(restoreDrillConfig(process.env)), null, 2));
} catch (error) {
  console.error(error instanceof RestoreDrillError ? error.message : "Database restore drill: UNAVAILABLE");
  process.exitCode = 1;
}
