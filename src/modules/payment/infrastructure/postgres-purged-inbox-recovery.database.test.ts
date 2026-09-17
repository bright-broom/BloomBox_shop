import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { PostgresDataRetentionJob } from "@/shared/infrastructure/database/data-retention-job";
import { InboxRecoveryUnavailableError } from "../application/restore-purged-inbox-event";
import type { VerifiedProviderEvent } from "../application/receive-provider-webhook";
import { PostgresWebhookInbox } from "./postgres-webhook-inbox";
import { PostgresPurgedInboxRecovery } from "./postgres-purged-inbox-recovery";
import { PostgresCommerceBacklog } from "./postgres-commerce-backlog";
const url = process.env.TEST_DATABASE_URL;
if (url && (!["localhost", "127.0.0.1"].includes(new URL(url).hostname) || !new URL(url).pathname.includes("test"))) throw new Error("Only local test databases are allowed");
const describeDatabase = url ? describe : describe.skip;
describeDatabase("audited purged Inbox recovery and backlog", () => {
  const sql = postgres(url ?? "postgres://invalid/test_missing", { max: 4, ssl: false });
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 15)]]) });
  const account = "acct_recovery_synthetic";
  const at = new Date("2026-09-17T00:00:00Z");
  const restoredAt = new Date("2026-09-17T03:00:00Z");
  const request = { externalEventId: "evt_recoverySynthetic001", incidentIssue: 137, requestedBy: "synthetic-operator" };
  const event: VerifiedProviderEvent = { provider: "STRIPE", providerAccountId: account, externalEventId: request.externalEventId,
    eventType: "refund.failed", externalObjectId: "re_synthetic", apiVersion: "2026-07-29.dahlia", occurredAt: at,
    payload: { objectType: "refund", id: "re_synthetic", customer: "sensitive synthetic payload" } };
  const retrieve = vi.fn(async () => event as VerifiedProviderEvent | null);
  const recovery = () => new PostgresPurgedInboxRecovery(sql, account, { retrieve }, protector, () => restoredAt);
  const row = async () => (await sql`SELECT * FROM bloombox.webhook_inbox WHERE external_event_id = ${request.externalEventId}`)[0];
  const audits = () => sql`SELECT * FROM bloombox.audit_logs WHERE action = 'provider.inbox.payload_restored'`;
  async function seed(value = event) {
    await new PostgresWebhookInbox(sql, protector, undefined, () => at, { provider: "STRIPE", accountId: value.providerAccountId }).record(value);
    await sql`UPDATE bloombox.webhook_inbox SET status = 'FAILED', attempts = 12, payload_key_id = NULL,
      payload_ciphertext = NULL, payload_purged_at = ${at} WHERE external_event_id = ${value.externalEventId}`;
  }
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], { env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_MODE: "disable" }, stdio: "pipe" });
  });
  beforeEach(async () => { await sql`DELETE FROM bloombox.webhook_inbox`; await sql`DELETE FROM bloombox.outbox_events`;
    await sql`DELETE FROM bloombox.audit_logs WHERE action = 'provider.inbox.payload_restored'`; retrieve.mockReset(); retrieve.mockResolvedValue(event); });
  afterAll(async () => { await sql.end({ timeout: 5 }); });
  it("restores encrypted verified payload and audit atomically; only the regular worker processes it", async () => {
    await seed();
    expect(await recovery().execute(request)).toEqual({ outcome: "RESTORED" });
    const actual = await row();
    expect(actual.status).toBe("PENDING"); expect(actual.attempts).toBe(0); expect(actual.processed_at).toBeNull();
    expect(actual.payload_ciphertext.toString()).not.toContain("sensitive");
    expect(actual.payload_expires_at.toISOString()).toBe("2026-09-18T03:00:00.000Z");
    const claimed = await new PostgresWebhookInbox(sql, protector, undefined, undefined, { provider: "STRIPE", accountId: account })
      .claim({ workerId: "synthetic", now: restoredAt, limit: 1, lockTimeoutMinutes: 5 });
    expect(claimed).toEqual([event]);
    const audit = (await audits())[0]; expect(audit.actor_reference).toBe("github:synthetic-operator");
    expect(audit.safe_metadata.incidentIssue).toBe(137); expect(JSON.stringify(audit)).not.toContain("sensitive");
  });
  it("runs with the existing worker database role", async () => {
    await seed();
    execFileSync("psql", [url!, "-f", "database/roles.sql"], { stdio: "pipe" });
    const worker = postgres(url!, { max: 1, ssl: false, connection: { options: "-c role=bloombox_worker" } });
    try {
      expect(await new PostgresPurgedInboxRecovery(worker, account, { retrieve }, protector, () => restoredAt).execute(request)).toEqual({ outcome: "RESTORED" });
      expect((await new PostgresCommerceBacklog(worker, account).execute()).inbox.entries).toHaveLength(1);
    } finally { await worker.end({ timeout: 5 }); }
  });
  it("serializes duplicate requests and writes one audit", async () => {
    await seed(); const results = await Promise.all([recovery().execute(request), recovery().execute(request)]);
    expect(results.filter((r) => r.outcome === "RESTORED")).toHaveLength(1); expect(await audits()).toHaveLength(1);
    expect((await row()).status).toBe("PENDING");
  });
  it("rolls back payload and status when the audit insert fails", async () => {
    await seed(); await sql.unsafe("CREATE FUNCTION bloombox.reject_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$");
    await sql.unsafe("CREATE TRIGGER reject_recovery BEFORE INSERT ON bloombox.audit_logs FOR EACH ROW EXECUTE FUNCTION bloombox.reject_recovery_audit()");
    try { await expect(recovery().execute(request)).rejects.toThrow(); expect((await row()).status).toBe("FAILED"); expect((await row()).payload_ciphertext).toBeNull(); }
    finally { await sql.unsafe("DROP TRIGGER reject_recovery ON bloombox.audit_logs"); await sql.unsafe("DROP FUNCTION bloombox.reject_recovery_audit()"); }
  });
  it.each(["providerAccountId", "externalEventId", "eventType", "externalObjectId", "apiVersion"] as const)("rejects mismatched %s", async (key) => {
    await seed(); retrieve.mockResolvedValue({ ...event, [key]: "different" });
    expect(await recovery().execute(request)).toEqual({ outcome: "EVENT_MISMATCH" }); expect((await row()).status).toBe("FAILED"); expect(await audits()).toHaveLength(0);
  });
  it("rejects changed occurrence time", async () => { await seed(); retrieve.mockResolvedValue({ ...event, occurredAt: restoredAt });
    expect(await recovery().execute(request)).toEqual({ outcome: "EVENT_MISMATCH" }); });
  it.each([null, new InboxRecoveryUnavailableError()])("keeps unavailable events failed", async (value) => {
    await seed(); if (value instanceof Error) retrieve.mockRejectedValue(value); else retrieve.mockResolvedValue(value);
    expect(await recovery().execute(request)).toEqual({ outcome: "PROVIDER_UNAVAILABLE" }); expect((await row()).status).toBe("FAILED");
  });
  it("does not call Stripe for a different account or retained/processed event", async () => {
    await seed({ ...event, providerAccountId: "acct_other_synthetic" });
    expect(await recovery().execute(request)).toEqual({ outcome: "NOT_FOUND" }); expect(retrieve).not.toHaveBeenCalled();
    await sql`DELETE FROM bloombox.webhook_inbox`; await new PostgresWebhookInbox(sql, protector).record(event);
    expect(await recovery().execute(request)).toEqual({ outcome: "NOT_FAILED" });
    await sql`UPDATE bloombox.webhook_inbox SET status = 'FAILED'`;
    expect(await recovery().execute(request)).toEqual({ outcome: "PAYLOAD_RETAINED" }); expect(retrieve).not.toHaveBeenCalled();
  });
  it("rechecks row state after the external request", async () => {
    await seed(); retrieve.mockImplementationOnce(async () => { await sql`UPDATE bloombox.webhook_inbox SET status = 'PROCESSED'`; return event; });
    expect(await recovery().execute(request)).toEqual({ outcome: "NOT_FAILED" }); expect(await audits()).toHaveLength(0);
  });
  it("expires restored terminal payload after 24h and forbids repeated retention extensions", async () => {
    await seed(); await recovery().execute(request); await sql`UPDATE bloombox.webhook_inbox SET status = 'FAILED'`;
    const job = new PostgresDataRetentionJob(sql);
    expect((await job.execute(new Date("2026-09-18T02:59:59Z"))).webhookPayloadsPurged).toBe(0);
    expect((await job.execute(new Date("2026-09-18T03:00:00Z"))).webhookPayloadsPurged).toBe(1);
    expect(await recovery().execute(request)).toEqual({ outcome: "ALREADY_RESTORED" }); expect(await audits()).toHaveLength(1);
  });
  it("paginates scoped metadata without leaking payloads and labels global Outbox counts", async () => {
    for (let i = 0; i < 52; i++) await seed({ ...event, externalEventId: `evt_syntheticPage${i}` });
    await seed({ ...event, externalEventId: "evt_otherAccount001", providerAccountId: "acct_other_synthetic" });
    await sql`INSERT INTO bloombox.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, available_at)
      VALUES (gen_random_uuid(), 'Payment', gen_random_uuid(), 'payment.captured', 1, '{"private":"never print me"}', ${at}, ${at})`;
    const reader = new PostgresCommerceBacklog(sql, account); const first = await reader.execute();
    expect(first.inbox.summary[0].count).toBe(52); expect(first.inbox.entries).toHaveLength(50); expect(first.inbox.nextCursor).not.toBeNull();
    const last = await reader.execute(first.inbox.nextCursor!); expect(last.inbox.entries).toHaveLength(2); expect(last.inbox.nextCursor).toBeNull();
    expect(new Set([...first.inbox.entries, ...last.inbox.entries].map((r) => r.id)).size).toBe(52);
    expect(first.outbox.scope).toBe("ALL_PROVIDERS"); expect(first.outbox.summary[0].count).toBe(1);
    const output = JSON.stringify(first); expect(output).not.toMatch(/sensitive|private|never print|ciphertext|acct_other/);
  });
});
