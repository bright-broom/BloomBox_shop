import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import type { VerifiedProviderEvent } from "../application/receive-provider-webhook";
import { PostgresCommerceWorkerAttention } from "./postgres-commerce-worker-attention";
import { PostgresFailedInboxRequeue } from "./postgres-failed-inbox-requeue";
import { PostgresWebhookInbox } from "./postgres-webhook-inbox";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeUrl(value: string | undefined): string {
  if (!value) return "postgres://invalid/test_missing";
  const url = new URL(value);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.slice(1).includes("test")) throw new Error("TEST_DATABASE_URL must target a local database whose name contains test");
  return value;
}
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("failed Stripe Inbox requeue", () => {
  const sql = postgres(safeUrl(databaseUrl), { max: 4, ssl: false });
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 13)]]) });
  const account = "acct_requeue_primary";
  const receivedAt = new Date("2026-09-14T00:00:00Z");
  const operator = { incidentIssue: 171, requestedBy: "bright-broom" } as const;

  function stripeEvent(externalEventId: string, providerAccountId = account): VerifiedProviderEvent {
    return {
      provider: "STRIPE", providerAccountId, externalEventId, eventType: "checkout.session.completed",
      externalObjectId: "cs_test_requeue", apiVersion: "2026-08-27.basil", occurredAt: receivedAt,
      payload: { id: externalEventId, type: "checkout.session.completed" },
    };
  }
  function inbox(accountId = account) {
    return new PostgresWebhookInbox(sql, protector, undefined, () => receivedAt, { provider: "STRIPE", accountId });
  }
  async function failedEvent(externalEventId: string, options: Readonly<{ accountId?: string; purged?: boolean }> = {}) {
    await inbox(options.accountId).record(stripeEvent(externalEventId, options.accountId));
    await sql`
      UPDATE bloombox.webhook_inbox
      SET status = 'FAILED', attempts = 12, last_error_code = 'InvalidStripeCommerceEventError', locked_at = NULL, locked_by = NULL
      WHERE external_event_id = ${externalEventId}
    `;
    if (options.purged) {
      await sql`
        UPDATE bloombox.webhook_inbox
        SET payload_key_id = NULL, payload_ciphertext = NULL, payload_purged_at = ${receivedAt}
        WHERE external_event_id = ${externalEventId}
      `;
    }
  }
  const inboxRow = async (externalEventId: string) => (await sql`
    SELECT status, attempts, available_at, locked_at, locked_by, last_error_code
    FROM bloombox.webhook_inbox WHERE external_event_id = ${externalEventId}
  `)[0];
  const requeueAudits = () => sql`
    SELECT actor_type, actor_reference, resource_type, safe_metadata, idempotency_key
    FROM bloombox.audit_logs WHERE action = 'provider.inbox.requeued' ORDER BY occurred_at
  `;

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], { env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe" });
  });
  beforeEach(async () => {
    await sql`DELETE FROM bloombox.webhook_inbox`;
    await sql`DELETE FROM bloombox.audit_logs WHERE action = 'provider.inbox.requeued'`;
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });

  it("returns a failed event with a retained payload to the worker queue and audits the operator", async () => {
    const id = "evt_requeueRetained001";
    await failedEvent(id);
    expect((await new PostgresCommerceWorkerAttention(sql).execute()).failedInboxEvents).toBe(1);

    const requestedAt = new Date("2026-09-14T03:00:00Z");
    const requeue = new PostgresFailedInboxRequeue(sql, account, () => requestedAt);
    await expect(requeue.execute({ externalEventIds: [id], ...operator }))
      .resolves.toEqual({ results: [{ externalEventId: id, outcome: "REQUEUED" }] });

    const row = await inboxRow(id);
    expect(row).toMatchObject({
      status: "PENDING", attempts: 0, locked_at: null, locked_by: null, last_error_code: "InvalidStripeCommerceEventError",
    });
    expect(new Date(row!.available_at).toISOString()).toBe(requestedAt.toISOString());
    const audits = await requeueAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_type: "OPERATOR",
      actor_reference: "github:bright-broom",
      resource_type: "CommerceEvent",
      safe_metadata: {
        externalEventId: id,
        eventType: "checkout.session.completed",
        previousAttempts: 12,
        previousErrorCode: "InvalidStripeCommerceEventError",
        incidentIssue: 171,
      },
    });
    // The worker attention no longer counts it, and the normal Inbox claim decrypts and processes it again.
    expect((await new PostgresCommerceWorkerAttention(sql).execute()).failedInboxEvents).toBe(0);
    await expect(inbox().claim({ workerId: "worker", now: requestedAt, limit: 10, lockTimeoutMinutes: 5 }))
      .resolves.toMatchObject([{ externalEventId: id, payload: { id } }]);
  });

  it("leaves pending, purged, unknown, and other-account events unchanged without an audit", async () => {
    const pending = "evt_requeuePending0001";
    const purged = "evt_requeuePurged00001";
    const otherAccount = "evt_requeueOtherAcct01";
    await inbox().record(stripeEvent(pending));
    await failedEvent(purged, { purged: true });
    await failedEvent(otherAccount, { accountId: "acct_requeue_other" });

    const requeue = new PostgresFailedInboxRequeue(sql, account, () => new Date("2026-09-14T03:00:00Z"));
    const result = await requeue.execute({ externalEventIds: [pending, purged, "evt_requeueUnknown0001", otherAccount], ...operator });

    expect(result.results.map((entry) => entry.outcome)).toEqual(["NOT_FAILED", "PAYLOAD_PURGED", "NOT_FOUND", "NOT_FOUND"]);
    expect(await inboxRow(pending)).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(await inboxRow(purged)).toMatchObject({ status: "FAILED", attempts: 12 });
    expect(await inboxRow(otherAccount)).toMatchObject({ status: "FAILED", attempts: 12 });
    expect(await requeueAudits()).toHaveLength(0);
  });

  it("requeues again after a later failure and keeps one audit per operator action", async () => {
    const id = "evt_requeueRepeated001";
    await failedEvent(id);
    await new PostgresFailedInboxRequeue(sql, account, () => new Date("2026-09-14T03:00:00Z")).execute({ externalEventIds: [id], ...operator });
    await sql`UPDATE bloombox.webhook_inbox SET status = 'FAILED', attempts = 12 WHERE external_event_id = ${id}`;

    await expect(new PostgresFailedInboxRequeue(sql, account, () => new Date("2026-09-14T05:00:00Z")).execute({ externalEventIds: [id], ...operator }))
      .resolves.toEqual({ results: [{ externalEventId: id, outcome: "REQUEUED" }] });
    const audits = await requeueAudits();
    expect(audits).toHaveLength(2);
    expect(new Set(audits.map((audit) => audit.idempotency_key)).size).toBe(2);
  });
});
