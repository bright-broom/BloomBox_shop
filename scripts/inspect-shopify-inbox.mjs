import postgres from "postgres";
import { inspectShopifyInbox, ShopifyInboxDiagnosticError } from "../src/modules/payment/infrastructure/shopify-inbox-diagnostics.ts";
import { PROVIDER_INBOX_LOCK_TIMEOUT_MINUTES } from "../src/modules/payment/application/provider-inbox-policy.ts";
import { loadInboxMonitorConfig } from "../src/shared/infrastructure/config/inbox-monitor-config.ts";

// Node 24 (CI baseline) runs the strictly checked, erasable TypeScript adapters directly.
let sql;
try {
  const [shop, age, ...extra] = process.argv.slice(2);
  if (!shop || !age || !/^[1-9]\d{0,6}$/.test(age) || extra.length) throw new ShopifyInboxDiagnosticError("INVALID_REQUEST");
  const config = loadInboxMonitorConfig();
  sql = postgres(config.url, { max: 1, ssl: config.ssl, connect_timeout: 5, prepare: false });
  const result = await inspectShopifyInbox(sql, { shop, maxPendingAgeSeconds: Number(age), lockTimeoutMinutes: PROVIDER_INBOX_LOCK_TIMEOUT_MINUTES });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "ATTENTION" ? 2 : 0;
} catch (error) {
  console.error(error instanceof ShopifyInboxDiagnosticError ? error.message : "Shopify Inbox diagnostic: UNAVAILABLE");
  process.exitCode = 1;
} finally { if (sql) await sql.end({ timeout: 5 }); }
