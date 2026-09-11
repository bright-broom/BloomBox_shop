import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { retryProviderWebhook, type WebhookRetryRequest } from "./retry-provider-webhook";
import { PostgresWebhookInbox } from "./postgres-webhook-inbox";
import { ProcessProviderInbox } from "../application/process-provider-inbox";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeUrl() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Local test database required");
  return databaseUrl;
}
const describeDatabase = databaseUrl ? describe : describe.skip;
describeDatabase("owner-reviewed webhook retry", () => {
  const sql = postgres(safeUrl(), { max: 8, ssl: false });
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 17)]]) });
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let i = 0; i < 2; i++) execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await sql.end(); });
  async function seed(provider: "SHOPIFY" | "STRIPE" = "SHOPIFY") {
    const request: WebhookRetryRequest = { changeId: randomUUID(), database: new URL(safeUrl()).pathname.slice(1), inboxId: randomUUID(),
      provider, accountId: provider === "SHOPIFY" ? "retry.myshopify.com" : "acct_retry",
      reviewExpiresAt: new Date(Date.now() + 300_000).toISOString(), reason: "DEPENDENCY_RECOVERED" };
    const event = { provider, providerAccountId: request.accountId, externalEventId: `private-event-${request.inboxId}`,
      externalObjectId: "private-order", apiVersion: "2026-07", eventType: "private-topic", occurredAt: new Date(), payload: { secret: "private-payload" } };
    const queue = new PostgresWebhookInbox(sql, protector, () => request.inboxId, undefined, { provider, accountId: request.accountId });
    await queue.record(event);
    await sql`UPDATE bloombox.webhook_inbox SET status = 'FAILED', attempts = 12,
      available_at = clock_timestamp() + interval '30 minutes', last_error_code = 'private-error' WHERE id = ${request.inboxId}`;
    return { request, event, queue };
  }
  async function current(id: string) { return (await sql`SELECT * FROM bloombox.webhook_inbox WHERE id = ${id}`)[0]; }

  it.each(["SHOPIFY", "STRIPE"] as const)("plans without writes and requeues %s exactly once through actual worker consumption", async (provider) => {
    const { request, event, queue } = await seed(provider);
    const before = await current(request.inboxId);
    const plan = await retryProviderWebhook(sql, request);
    expect(plan).toMatchObject({ outcome: "PLAN", before: { status: "FAILED", attempts: 12 }, proposed: { status: "PENDING", attempts: 0 } });
    expect(await retryProviderWebhook(sql, request)).toEqual(plan);
    expect(await current(request.inboxId)).toEqual(before);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE id = ${request.changeId}`).toHaveLength(0);
    const results = await Promise.all(Array.from({ length: 6 }, () => retryProviderWebhook(sql, request, plan.planHash)));
    expect(results.filter((result) => result.outcome === "APPLIED")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "DUPLICATE")).toHaveLength(5);
    const pending = await current(request.inboxId);
    expect(pending.status).toBe("PENDING"); expect(pending.attempts).toBe(0);
    expect(pending.payload_ciphertext).toEqual(before.payload_ciphertext);
    expect(pending.external_event_id).toBe(before.external_event_id);
    const processor = { process: vi.fn() };
    await new ProcessProviderInbox(queue, processor).execute();
    expect(processor.process).toHaveBeenCalledWith(event);
    expect(await retryProviderWebhook(sql, request, plan.planHash)).toMatchObject({ outcome: "DUPLICATE" });
    expect((await current(request.inboxId)).status).toBe("PROCESSED");
    const audit = (await sql`SELECT safe_metadata FROM bloombox.audit_logs WHERE id = ${request.changeId}`)[0];
    expect(audit.safe_metadata).toMatchObject({ before: { status: "FAILED", attempts: 12 }, after: { status: "PENDING", attempts: 0 } });
    expect(JSON.stringify({ plan, results, audit })).not.toMatch(/private-|payload_hash|ciphertext/);
  });

  it("does not reset a re-failed or purged event when the original request is retried", async () => {
    const { request } = await seed(); const plan = await retryProviderWebhook(sql, request);
    await retryProviderWebhook(sql, request, plan.planHash);
    await sql`UPDATE bloombox.webhook_inbox SET status = 'FAILED', attempts = 12, payload_ciphertext = NULL,
      payload_key_id = NULL, payload_purged_at = clock_timestamp() WHERE id = ${request.inboxId}`;
    const before = await current(request.inboxId);
    expect(await retryProviderWebhook(sql, request, plan.planHash)).toMatchObject({ outcome: "DUPLICATE" });
    expect(await current(request.inboxId)).toEqual(before);
  });

  it("rejects different requests or confirmations using an already committed change ID", async () => {
    const { request } = await seed(); const plan = await retryProviderWebhook(sql, request);
    await retryProviderWebhook(sql, request, plan.planHash);
    await expect(retryProviderWebhook(sql, { ...request, reason: "KEYS_RESTORED" }, plan.planHash)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(retryProviderWebhook(sql, request, "0".repeat(64))).rejects.toMatchObject({ code: "CONFLICT" });
    const other = await seed();
    await expect(retryProviderWebhook(sql, { ...other.request, changeId: request.changeId })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it.each(["PENDING", "PROCESSING", "PROCESSED"])("never requeues a %s record", async (status) => {
    const { request } = await seed();
    await sql`UPDATE bloombox.webhook_inbox SET status = ${status} WHERE id = ${request.inboxId}`;
    await expect(retryProviderWebhook(sql, request)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  });

  it.each(["EXPIRED_PAYLOAD", "PURGED_PAYLOAD", "LOCKED", "PROCESSED_BEFORE", "EXPIRED_REVIEW", "LONG_REVIEW", "NO_ATTEMPTS", "BAD_METADATA"])(
    "rejects ineligible state: %s", async (condition) => {
      const { request } = await seed();
      if (condition === "EXPIRED_PAYLOAD") await sql`UPDATE bloombox.webhook_inbox SET payload_expires_at = clock_timestamp() WHERE id = ${request.inboxId}`;
      if (condition === "PURGED_PAYLOAD") await sql`UPDATE bloombox.webhook_inbox SET payload_ciphertext = NULL, payload_key_id = NULL, payload_purged_at = clock_timestamp() WHERE id = ${request.inboxId}`;
      if (condition === "LOCKED") await sql`UPDATE bloombox.webhook_inbox SET locked_by = 'worker', locked_at = clock_timestamp() WHERE id = ${request.inboxId}`;
      if (condition === "PROCESSED_BEFORE") await sql`UPDATE bloombox.webhook_inbox SET processed_at = clock_timestamp() WHERE id = ${request.inboxId}`;
      if (condition === "NO_ATTEMPTS") await sql`UPDATE bloombox.webhook_inbox SET attempts = 0 WHERE id = ${request.inboxId}`;
      if (condition === "BAD_METADATA") await sql`UPDATE bloombox.webhook_inbox SET api_version = NULL WHERE id = ${request.inboxId}`;
      const input = { ...request, reviewExpiresAt: condition === "EXPIRED_REVIEW" ? new Date(Date.now() - 1_000).toISOString()
        : condition === "LONG_REVIEW" ? new Date(Date.now() + 3_600_000).toISOString() : request.reviewExpiresAt };
      await expect(retryProviderWebhook(sql, input)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    },
  );

  it("requires the exact database, provider and account, and rejects unknown input fields", async () => {
    const { request } = await seed();
    await expect(retryProviderWebhook(sql, { ...request, database: "different_test" })).rejects.toMatchObject({ code: "WRONG_DATABASE" });
    await expect(retryProviderWebhook(sql, { ...request, accountId: "other.myshopify.com" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(retryProviderWebhook(sql, { ...request, provider: "STRIPE", accountId: "acct_other" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(retryProviderWebhook(sql, { ...request, accountId: "invalid'" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(retryProviderWebhook(sql, { ...request, ignoreExpiry: true })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(retryProviderWebhook(sql, request, "bad")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it.each(["PAYLOAD", "REFERENCE", "ATTEMPTS"])("invalidates a plan if the reviewed %s changes", async (field) => {
    const { request } = await seed(); const plan = await retryProviderWebhook(sql, request);
    if (field === "PAYLOAD") await sql`UPDATE bloombox.webhook_inbox SET payload_ciphertext = ${Buffer.from("changed-private-payload")} WHERE id = ${request.inboxId}`;
    if (field === "REFERENCE") await sql`UPDATE bloombox.webhook_inbox SET external_object_id = 'changed-private-order' WHERE id = ${request.inboxId}`;
    if (field === "ATTEMPTS") await sql`UPDATE bloombox.webhook_inbox SET attempts = attempts + 1 WHERE id = ${request.inboxId}`;
    await expect(retryProviderWebhook(sql, request, plan.planHash)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE id = ${request.changeId}`).toHaveLength(0);
  });

  it("serializes two different reviewed requests for the same event", async () => {
    const { request } = await seed(); const other = { ...request, changeId: randomUUID() };
    const firstPlan = await retryProviderWebhook(sql, request), secondPlan = await retryProviderWebhook(sql, other);
    const results = await Promise.allSettled([retryProviderWebhook(sql, request, firstPlan.planHash), retryProviderWebhook(sql, other, secondPlan.planHash)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE resource_id = ${request.inboxId}`).toHaveLength(1);
  });

  it("denies runtime roles before plan/apply and prevents forged retry receipts", async () => {
    const { request } = await seed(); const plan = await retryProviderWebhook(sql, request);
    for (const role of ["bloombox_application", "bloombox_worker", "bloombox_readonly", "bloombox_inbox_monitor", "bloombox_fulfillment_approver", "bloombox_permission_manager"]) {
      const restricted = postgres(safeUrl(), { max: 1, ssl: false, connection: { role } });
      try {
        await expect(retryProviderWebhook(restricted, request)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
        await expect(retryProviderWebhook(restricted, request, plan.planHash)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
        await expect(restricted`INSERT INTO bloombox.audit_logs (id, actor_type, actor_reference, action, resource_type, resource_id, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'SYSTEM', 'webhook-retry', 'payment.webhook.retry_requested', 'WebhookInbox', ${request.inboxId}, '{}', clock_timestamp())`)
          .rejects.toMatchObject({ code: "42501" });
        for (const status of ["PENDING", "PROCESSING", "PROCESSED"]) {
          await expect(restricted`UPDATE bloombox.webhook_inbox SET status = ${status} WHERE id = ${request.inboxId}`).rejects.toMatchObject({ code: "42501" });
        }
      } finally { await restricted.end(); }
    }
  });

  it("keeps receipts immutable and rejects missing or disabled audit protection", async () => {
    const { request } = await seed(); const plan = await retryProviderWebhook(sql, request);
    await sql.unsafe("ALTER TABLE bloombox.audit_logs DISABLE TRIGGER webhook_retry_audit_protected");
    try {
      await expect(retryProviderWebhook(sql, request)).rejects.toMatchObject({ code: "UNAVAILABLE" });
      await expect(retryProviderWebhook(sql, request, plan.planHash)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    } finally { await sql.unsafe("ALTER TABLE bloombox.audit_logs ENABLE TRIGGER webhook_retry_audit_protected"); }
    await sql.unsafe("ALTER TRIGGER webhook_retry_audit_protected ON bloombox.audit_logs RENAME TO test_missing_retry_guard");
    try { await expect(retryProviderWebhook(sql, request)).rejects.toMatchObject({ code: "UNAVAILABLE" }); }
    finally { await sql.unsafe("ALTER TRIGGER test_missing_retry_guard ON bloombox.audit_logs RENAME TO webhook_retry_audit_protected"); }
    await sql.unsafe("ALTER TABLE bloombox.webhook_inbox DISABLE TRIGGER webhook_failed_retry_protected");
    try { await expect(retryProviderWebhook(sql, request, plan.planHash)).rejects.toMatchObject({ code: "UNAVAILABLE" }); }
    finally { await sql.unsafe("ALTER TABLE bloombox.webhook_inbox ENABLE TRIGGER webhook_failed_retry_protected"); }
    await retryProviderWebhook(sql, request, plan.planHash);
    await expect(sql`UPDATE bloombox.audit_logs SET action = 'changed' WHERE id = ${request.changeId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM bloombox.audit_logs WHERE id = ${request.changeId}`).rejects.toMatchObject({ code: "23514" });
  });

  it.each(["REVIEW", "PAYLOAD"])("rolls back both the queue change and audit when %s expiry crosses during persistence", async (expiry) => {
    const { request } = await seed(); const short = { ...request, reviewExpiresAt: expiry === "REVIEW" ? new Date(Date.now() + 1_000).toISOString() : request.reviewExpiresAt };
    if (expiry === "PAYLOAD") await sql`UPDATE bloombox.webhook_inbox SET payload_expires_at = clock_timestamp() + interval '1 second' WHERE id = ${request.inboxId}`;
    const plan = await retryProviderWebhook(sql, short);
    await sql.unsafe(`CREATE FUNCTION bloombox.test_retry_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'payment.webhook.retry_requested' THEN PERFORM pg_sleep(1.2); END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_retry_delay BEFORE INSERT ON bloombox.audit_logs FOR EACH ROW EXECUTE FUNCTION bloombox.test_retry_delay()`);
    try { await expect(retryProviderWebhook(sql, short, plan.planHash)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" }); }
    finally { await sql.unsafe("DROP TRIGGER test_retry_delay ON bloombox.audit_logs; DROP FUNCTION bloombox.test_retry_delay()"); }
    expect((await current(request.inboxId)).status).toBe("FAILED");
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE id = ${request.changeId}`).toHaveLength(0);
  });

  it("rolls back the queue when audit persistence fails and does not expose driver detail", async () => {
    const { request } = await seed(); const plan = await retryProviderWebhook(sql, request);
    const before = await current(request.inboxId);
    await sql.unsafe(`CREATE FUNCTION bloombox.test_retry_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'payment.webhook.retry_requested' THEN RAISE EXCEPTION 'private-database-detail'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_retry_failure BEFORE INSERT ON bloombox.audit_logs FOR EACH ROW EXECUTE FUNCTION bloombox.test_retry_failure()`);
    try { await expect(retryProviderWebhook(sql, request, plan.planHash)).rejects.toMatchObject({ code: "UNAVAILABLE", message: "Webhook retry: UNAVAILABLE" }); }
    finally { await sql.unsafe("DROP TRIGGER test_retry_failure ON bloombox.audit_logs; DROP FUNCTION bloombox.test_retry_failure()"); }
    expect(await current(request.inboxId)).toEqual(before);
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE id = ${request.changeId}`).toHaveLength(0);
  });

  it("stops on a competing row lock without changing the queue or leaving a receipt", async () => {
    const { request } = await seed(); const plan = await retryProviderWebhook(sql, request);
    let release: () => void = () => {}; let acquired: () => void = () => {};
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const lock = sql.begin(async (tx) => { await tx`SELECT id FROM bloombox.webhook_inbox WHERE id = ${request.inboxId} FOR UPDATE`; acquired(); await hold; });
    try { await ready; await expect(retryProviderWebhook(sql, request, plan.planHash)).rejects.toMatchObject({ code: "UNAVAILABLE" }); }
    finally { release(); await lock; }
    expect((await current(request.inboxId)).status).toBe("FAILED");
    expect(await sql`SELECT id FROM bloombox.audit_logs WHERE id = ${request.changeId}`).toHaveLength(0);
  });

  it("executes the real CLI as plan then apply and rejects oversized input", async () => {
    const { request } = await seed(); const directory = await mkdtemp(join(tmpdir(), "bloombox-webhook-retry-"));
    const file = join(directory, "request.json");
    const run = (args: string[]) => promisify(execFile)(process.execPath, ["scripts/retry-provider-webhook.mjs", ...args], {
      env: { ...process.env, DATABASE_WEBHOOK_ADMIN_URL: safeUrl(), DATABASE_SSL_MODE: "disable" },
    });
    try {
      await writeFile(file, JSON.stringify(request), { mode: 0o600 });
      const plan = JSON.parse((await run([file])).stdout);
      expect(plan.outcome).toBe("PLAN");
      expect(JSON.parse((await run([file, `--apply=${plan.planHash}`])).stdout).outcome).toBe("APPLIED");
      expect(JSON.parse((await run([file, `--apply=${plan.planHash}`])).stdout).outcome).toBe("DUPLICATE");
      await writeFile(file, "x".repeat(16_385));
      await expect(run([file])).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("INVALID_REQUEST") });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
