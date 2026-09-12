import { open } from "node:fs/promises";
import postgres from "postgres";
import { provisionOperatorAccess, OperatorAccessProvisioningError } from "../src/modules/fulfillment/infrastructure/operator-access-provisioning.ts";

// Node 24 (the CI baseline) executes the strictly checked, erasable TypeScript adapter directly.
let sql;
try {
  const [file, mode, ...extra] = process.argv.slice(2);
  if (!file || extra.length || (mode !== undefined && !/^--apply=[a-f0-9]{64}$/.test(mode))) throw new OperatorAccessProvisioningError("INVALID_REQUEST");
  const url = new URL(process.env.DATABASE_OPERATOR_ADMIN_URL ?? "");
  const sslMode = process.env.DATABASE_SSL_MODE ?? "verify-full";
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || url.search || url.hash
    || !["verify-full", "disable"].includes(sslMode)
    || (sslMode === "disable" && !["localhost", "127.0.0.1"].includes(url.hostname))) throw new OperatorAccessProvisioningError("INVALID_REQUEST");
  const handle = await open(file, "r");
  let input;
  try {
    if (!(await handle.stat()).isFile()) throw new OperatorAccessProvisioningError("INVALID_REQUEST");
    const buffer = Buffer.alloc(16_385);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 16_384) throw new OperatorAccessProvisioningError("INVALID_REQUEST");
    input = JSON.parse(buffer.subarray(0, size).toString("utf8"));
  } finally { await handle.close(); }
  sql = postgres(url.toString(), { max: 1, ssl: sslMode === "disable" ? false : "verify-full", connect_timeout: 5, prepare: false });
  const result = await provisionOperatorAccess(sql, input, mode?.slice("--apply=".length));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof OperatorAccessProvisioningError ? error.message : "Operator access provisioning: UNAVAILABLE");
  process.exitCode = 1;
} finally { if (sql) await sql.end({ timeout: 5 }); }
