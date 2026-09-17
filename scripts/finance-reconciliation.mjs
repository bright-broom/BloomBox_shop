import Stripe from "stripe";
import postgres from "postgres";
import { z } from "zod";
import { reconcileFinance } from "../src/modules/payment/domain/finance-reconciliation.ts";
import { readLocalFinance, readProviderFinance } from "../src/modules/payment/infrastructure/finance-reconciliation-reader.ts";
import { STRIPE_API_VERSION } from "../src/shared/infrastructure/config/stripe-config.ts";

// Node 24 executes the pure TypeScript modules; type-only imports are erased.
let sql;
let stage = "設定";
try {
  const env = z.object({
    DATABASE_FINANCE_REPORT_URL: z.url(),
    DATABASE_FINANCE_REPORT_SSL: z.enum(["require", "disable"]).default("require"),
    STRIPE_FINANCE_READ_KEY: z.string().regex(/^rk_(test|live)_[a-zA-Z0-9]+$/),
    STRIPE_ACCOUNT_ID: z.string().regex(/^acct_[a-zA-Z0-9]+$/),
    STRIPE_MODE: z.enum(["test", "live"]),
  }).parse(process.env);
  if (!env.STRIPE_FINANCE_READ_KEY.startsWith(`rk_${env.STRIPE_MODE}_`)) throw new Error("Mode mismatch");
  const database = new URL(env.DATABASE_FINANCE_REPORT_URL);
  if (!["postgres:", "postgresql:"].includes(database.protocol)) throw new Error("Database protocol mismatch");
  if (env.DATABASE_FINANCE_REPORT_SSL === "disable" && !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("TLS required");
  sql = postgres(env.DATABASE_FINANCE_REPORT_URL, { max: 1, ssl: env.DATABASE_FINANCE_REPORT_SSL === "require" ? "require" : false,
    connect_timeout: 10, idle_timeout: 10, connection: { application_name: "bloombox-finance-readonly", options: "-c default_transaction_read_only=on" } });
  const stripe = new Stripe(env.STRIPE_FINANCE_READ_KEY, { maxNetworkRetries: 1, timeout: 15_000, telemetry: false });
  const startedAt = new Date().toISOString();
  stage = "DB読取";
  const local = await readLocalFinance(sql);
  const databaseReadAt = new Date().toISOString();
  stage = "Stripe読取";
  const provider = await readProviderFinance(stripe, env.STRIPE_MODE, env.STRIPE_ACCOUNT_ID, STRIPE_API_VERSION);
  stage = "集計";
  const report = reconcileFinance(local, provider);
  process.stdout.write(`${JSON.stringify({ version: 1, scope: "complete-bounded-stripe-history", mode: env.STRIPE_MODE,
    startedAt, databaseReadAt, completedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
  if (report.status === "NEEDS_REVIEW") process.exitCode = 2;
} catch {
  // Do not print provider response bodies, credentials, personal fields or partial financial totals.
  process.stderr.write(`照合レポートを完了できませんでした（${stage}）。読取権限・接続・対象アカウント・件数上限・応答形式を確認してください。\n`);
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
