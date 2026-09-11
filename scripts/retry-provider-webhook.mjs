import { open } from "node:fs/promises";
import postgres from "postgres";
import { retryProviderWebhook, WebhookRetryError } from "../src/modules/payment/infrastructure/retry-provider-webhook.ts";
import { loadWebhookRetryConfig } from "../src/shared/infrastructure/config/webhook-retry-config.ts";

// Node 24 runs the strictly checked, erasable TypeScript adapter directly.
let sql;
try {
  const [file, mode, ...extra] = process.argv.slice(2);
  if (!file || extra.length || (mode !== undefined && !/^--apply=[a-f0-9]{64}$/.test(mode))) throw new WebhookRetryError("INVALID_REQUEST");
  const config = loadWebhookRetryConfig();
  const handle = await open(file, "r");
  let input;
  try {
    if (!(await handle.stat()).isFile()) throw new WebhookRetryError("INVALID_REQUEST");
    const buffer = Buffer.alloc(16_385);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 16_384) throw new WebhookRetryError("INVALID_REQUEST");
    input = JSON.parse(buffer.subarray(0, size).toString("utf8"));
  } finally { await handle.close(); }
  sql = postgres(config.url, { max: 1, ssl: config.ssl, connect_timeout: 5, prepare: false });
  console.log(JSON.stringify(await retryProviderWebhook(sql, input, mode?.slice("--apply=".length)), null, 2));
} catch (error) {
  console.error(error instanceof WebhookRetryError ? error.message : "Webhook retry: UNAVAILABLE");
  process.exitCode = 1;
} finally { if (sql) await sql.end({ timeout: 5 }); }
