import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROVIDER_INBOX_LOCK_TIMEOUT_MINUTES } from "../application/process-provider-inbox";
import { inspectShopifyInbox, SHOPIFY_INBOX_DIAGNOSTIC_LIMIT, ShopifyInboxDiagnosticError } from "./shopify-inbox-diagnostics";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeUrl() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Local test database required");
  return databaseUrl;
}
const describeDatabase = databaseUrl ? describe : describe.skip;
describeDatabase("metadata-only Shopify Inbox diagnostics", () => {
  const sql = postgres(safeUrl(), { max: 4, ssl: false });
  const monitor = postgres(safeUrl(), { max: 1, ssl: false, connection: { role: "bloombox_inbox_monitor" } });
  const request = { shop: "example.myshopify.com", maxPendingAgeSeconds: 900, lockTimeoutMinutes: PROVIDER_INBOX_LOCK_TIMEOUT_MINUTES };
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let i = 0; i < 2; i++) execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  beforeEach(async () => { await sql`DELETE FROM bloombox.webhook_inbox`; });
  afterAll(async () => { await monitor.end(); await sql.end(); });
  async function seed(status = "PENDING", age = 30, provider = "SHOPIFY", shop = request.shop) {
    const id = randomUUID();
    await sql`
      INSERT INTO bloombox.webhook_inbox (id, commerce_provider, provider_account_id, external_event_id,
        event_type, external_object_id, api_version, status, payload_key_id, payload_ciphertext,
        payload_expires_at, received_at, provider_occurred_at, available_at, locked_at, locked_by, last_error_code)
      VALUES (${id}, ${provider}, ${shop}, ${`private-event-${id}`}, 'private-topic', 'private-order', '2026-07',
        ${status}, 'private-key', ${Buffer.from("private-payload")}, statement_timestamp() + interval '1 day',
        statement_timestamp() - ${age} * interval '1 second', statement_timestamp(), statement_timestamp(),
        CASE WHEN ${status} = 'PROCESSING' THEN statement_timestamp() ELSE NULL END, 'private-worker', 'private-error')
    `;
    return id;
  }
  it("reports an empty scope without claiming that delivery or the processor is healthy", async () => {
    await seed("FAILED", 1_000, "STRIPE"); await seed("FAILED", 1_000, "SHOPIFY", "other.myshopify.com");
    await seed("PROCESSED", 1_000);
    expect(await inspectShopifyInbox(monitor, request)).toMatchObject({ status: "EMPTY", coverage: "COMPLETE",
      counts: { observed: 0, pending: 0, processing: 0, failed: 0 }, oldestPendingAgeSeconds: null, reasons: [] });
  });
  it("distinguishes pending, delayed retries, active processing and failed events without changing records", async () => {
    await seed(); const delayed = await seed(); await seed("PROCESSING"); await seed("FAILED");
    await sql`UPDATE bloombox.webhook_inbox SET available_at = statement_timestamp() + interval '1 hour', attempts = 2 WHERE id = ${delayed}`;
    const before = await sql`SELECT * FROM bloombox.webhook_inbox ORDER BY id`;
    for (let i = 0; i < 2; i++) {
      const result = await inspectShopifyInbox(monitor, request);
      expect(result).toMatchObject({ status: "ATTENTION", coverage: "COMPLETE", counts: {
        observed: 4, pending: 2, ready: 1, scheduled: 1, retrying: 1, processing: 1, stalled: 0, failed: 1,
      }, reasons: ["FAILED_EVENTS"] });
      expect(result.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(30);
      expect(JSON.stringify(result)).not.toMatch(/private-|ciphertext|external_event|locked_by|last_error/);
    }
    expect(await sql`SELECT * FROM bloombox.webhook_inbox ORDER BY id`).toEqual(before);
    expect(await sql`SELECT id FROM bloombox.audit_logs`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.outbox_events`).toHaveLength(0);
  });
  it("uses the database clock and inclusive age threshold, even for scheduled retries", async () => {
    const id = await seed("PENDING", 900);
    await sql`UPDATE bloombox.webhook_inbox SET available_at = statement_timestamp() + interval '1 hour' WHERE id = ${id}`;
    expect(await inspectShopifyInbox(monitor, request)).toMatchObject({ status: "ATTENTION", reasons: ["PENDING_TOO_OLD"] });
    expect(await inspectShopifyInbox(monitor, { ...request, maxPendingAgeSeconds: 960 })).toMatchObject({ status: "WITHIN_LIMITS", reasons: [] });
  });
  it("detects expired, missing and future processing locks plus retention and missing payloads", async () => {
    const old = await seed("PROCESSING"); const missing = await seed("PROCESSING"); const future = await seed("PROCESSING");
    await sql`UPDATE bloombox.webhook_inbox SET locked_at = statement_timestamp() - interval '5 minutes', payload_expires_at = statement_timestamp() WHERE id = ${old}`;
    await sql`UPDATE bloombox.webhook_inbox SET locked_at = NULL, payload_ciphertext = NULL, payload_key_id = NULL, payload_purged_at = statement_timestamp() WHERE id = ${missing}`;
    await sql`UPDATE bloombox.webhook_inbox SET locked_at = statement_timestamp() + interval '1 hour' WHERE id = ${future}`;
    expect(await inspectShopifyInbox(monitor, request)).toMatchObject({ status: "ATTENTION",
      counts: { processing: 3, stalled: 2, expiredPayloads: 1, missingPayloads: 1, invalidTimes: 1 },
      reasons: ["STALE_CLAIMS", "PAYLOAD_RETENTION_EXCEEDED", "PAYLOAD_UNAVAILABLE", "INVALID_TIMESTAMPS"] });
  });
  it("flags future receipt times instead of silently treating them as healthy", async () => {
    await seed("PENDING", -60);
    expect(await inspectShopifyInbox(monitor, request)).toMatchObject({ status: "ATTENTION", oldestPendingAgeSeconds: 0, reasons: ["INVALID_TIMESTAMPS"] });
  });
  it("caps the oldest-first scan, marks counts as lower bounds and never returns a false healthy result", async () => {
    await sql`
      INSERT INTO bloombox.webhook_inbox (id, commerce_provider, provider_account_id, external_event_id, event_type,
        status, payload_key_id, payload_ciphertext, payload_expires_at, received_at, provider_occurred_at)
      SELECT md5(n::text)::uuid, 'SHOPIFY', ${request.shop}, n::text, 'shopify.order.changed', 'PENDING', 'test',
        ${Buffer.from("fixture")}, statement_timestamp() + interval '1 day', statement_timestamp(), statement_timestamp()
      FROM generate_series(1, ${SHOPIFY_INBOX_DIAGNOSTIC_LIMIT + 2}) AS n
    `;
    expect(await inspectShopifyInbox(monitor, request)).toMatchObject({ status: "ATTENTION", coverage: "LOWER_BOUND",
      counts: { observed: SHOPIFY_INBOX_DIAGNOSTIC_LIMIT + 1, pending: SHOPIFY_INBOX_DIAGNOSTIC_LIMIT + 1 }, reasons: ["SCAN_LIMIT_REACHED"] });
    await sql`DELETE FROM bloombox.webhook_inbox WHERE external_event_id IN ('10001', '10002')`;
    expect(await inspectShopifyInbox(monitor, request)).toMatchObject({ status: "WITHIN_LIMITS", coverage: "COMPLETE", counts: { observed: SHOPIFY_INBOX_DIAGNOSTIC_LIMIT } });
  });
  it("denies payload, external identifiers, event errors, commerce tables and all writes at the database role boundary", async () => {
    await seed();
    for (const column of ["payload_ciphertext", "payload_key_id", "external_event_id", "external_object_id", "last_error_code", "locked_by"]) {
      await expect(monitor`SELECT ${monitor(column)} FROM bloombox.webhook_inbox`).rejects.toMatchObject({ code: "42501" });
    }
    await expect(monitor`SELECT * FROM bloombox.orders`).rejects.toMatchObject({ code: "42501" });
    await expect(monitor`UPDATE bloombox.webhook_inbox SET status = 'PROCESSED'`).rejects.toMatchObject({ code: "42501" });
    await expect(monitor`DELETE FROM bloombox.webhook_inbox`).rejects.toMatchObject({ code: "42501" });
  });
  it.each([{}, { shop: "example.myshopify.com' OR true--" }, { maxPendingAgeSeconds: 0 }, { lockTimeoutMinutes: 0 }, { extra: "ignored" }])("rejects malformed diagnostic requests: %#", async (override) => {
    await expect(inspectShopifyInbox(monitor, Object.keys(override).length ? { ...request, ...override } : {})).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("returns only a fixed error when a table lock prevents timely inspection", async () => {
    let release: () => void = () => {};
    let acquired: () => void = () => {};
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const lock = sql.begin(async (tx) => { await tx`LOCK TABLE bloombox.webhook_inbox IN ACCESS EXCLUSIVE MODE`; acquired(); await hold; });
    try {
      await ready;
      await expect(inspectShopifyInbox(monitor, request)).rejects.toEqual(new ShopifyInboxDiagnosticError("UNAVAILABLE"));
    } finally { release(); await lock; }
    expect(await inspectShopifyInbox(monitor, request)).toMatchObject({ status: "EMPTY" });
  });
  it("runs the actual CLI with restricted credentials and emits actionable exit codes without secrets", async () => {
    const role = `inbox_test_${randomUUID().replaceAll("-", "")}`;
    const password = randomUUID();
    const url = new URL(safeUrl()); url.username = role; url.password = password;
    await sql.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    await sql.unsafe(`GRANT bloombox_inbox_monitor TO ${role}`);
    const run = (args = [request.shop, "900"]) => promisify(execFile)(process.execPath, ["scripts/inspect-shopify-inbox.mjs", ...args], {
      env: { ...process.env, DATABASE_INBOX_MONITOR_URL: url.toString(), DATABASE_SSL_MODE: "disable" },
    });
    try {
      expect(JSON.parse((await run()).stdout)).toMatchObject({ status: "EMPTY" });
      await seed("FAILED");
      await expect(run()).rejects.toMatchObject({ code: 2, stdout: expect.stringContaining('"FAILED_EVENTS"') });
      await expect(run([request.shop, "0"])).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("INVALID_REQUEST") });
      await sql.unsafe(`REVOKE bloombox_inbox_monitor FROM ${role}`);
      await expect(run()).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("Shopify Inbox diagnostic: UNAVAILABLE") });
    } finally { await sql.unsafe(`DROP ROLE ${role}`); }
  });
});
