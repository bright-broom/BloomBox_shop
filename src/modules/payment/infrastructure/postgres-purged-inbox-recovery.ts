import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { InboxRecoveryUnavailableError, parseRestorePurgedInboxRequest, RESTORED_INBOX_RETENTION_HOURS,
  type PurgedInboxEventSource, type RestorePurgedInboxRequest, type RestorePurgedInboxOutcome } from "../application/restore-purged-inbox-event";

const rowSchema = z.object({ id: z.string().uuid(), status: z.enum(["PENDING", "PROCESSING", "PROCESSED", "FAILED"]),
  event_type: z.string(), external_object_id: z.string().nullable(), api_version: z.string().nullable(),
  provider_occurred_at: z.date(), payload_purged_at: z.date().nullable() });
const ACTION = "provider.inbox.payload_restored";

export class PostgresPurgedInboxRecovery {
  constructor(private readonly sql: DatabaseClient, private readonly accountId: string,
    private readonly source: PurgedInboxEventSource, private readonly protector: AesGcmDataProtector,
    private readonly now: () => Date = () => new Date()) {}

  async execute(input: RestorePurgedInboxRequest): Promise<{ outcome: RestorePurgedInboxOutcome }> {
    const request = parseRestorePurgedInboxRequest(input);
    const rows = await this.sql`SELECT id, status, event_type, external_object_id, api_version, provider_occurred_at, payload_purged_at
      FROM bloombox.webhook_inbox WHERE commerce_provider = 'STRIPE' AND provider_account_id = ${this.accountId}
      AND external_event_id = ${request.externalEventId}`;
    if (!rows[0]) return { outcome: "NOT_FOUND" };
    const snapshot = rowSchema.parse(rows[0]);
    if (snapshot.status !== "FAILED") return { outcome: "NOT_FAILED" };
    if (!snapshot.payload_purged_at) return { outcome: "PAYLOAD_RETAINED" };
    let event;
    try { event = await this.source.retrieve(request.externalEventId); }
    catch (error) { if (error instanceof InboxRecoveryUnavailableError) return { outcome: "PROVIDER_UNAVAILABLE" }; throw error; }
    if (!event) return { outcome: "PROVIDER_UNAVAILABLE" };
    if (event.provider !== "STRIPE" || event.providerAccountId !== this.accountId || event.externalEventId !== request.externalEventId
      || event.eventType !== snapshot.event_type || (event.externalObjectId ?? null) !== snapshot.external_object_id
      || event.apiVersion !== snapshot.api_version || event.occurredAt.getTime() !== snapshot.provider_occurred_at.getTime()) {
      return { outcome: "EVENT_MISMATCH" };
    }
    const protectedPayload = this.protector.protect(JSON.stringify(event.payload), `webhook:STRIPE:${this.accountId}:${request.externalEventId}:v1`);
    // Network requests above never hold DB locks. Revalidate after taking the lock to serialize concurrent recovery/retention.
    return this.sql.begin(async (tx): Promise<{ outcome: RestorePurgedInboxOutcome }> => {
      const locked = await tx`SELECT id, status, event_type, external_object_id, api_version, provider_occurred_at, payload_purged_at
        FROM bloombox.webhook_inbox WHERE id = ${snapshot.id} FOR UPDATE`;
      if (!locked[0]) return { outcome: "NOT_FOUND" };
      const row = rowSchema.parse(locked[0]);
      if (row.status !== "FAILED") return { outcome: "NOT_FAILED" };
      if (!row.payload_purged_at) return { outcome: "PAYLOAD_RETAINED" };
      if (JSON.stringify(row) !== JSON.stringify(snapshot)) return { outcome: "EVENT_MISMATCH" };
      const key = `inbox-payload-restore:${row.id}`;
      const prior = await tx`SELECT id FROM bloombox.audit_logs WHERE idempotency_key = ${key}`;
      if (prior.length) return { outcome: "ALREADY_RESTORED" };
      const restoredAt = this.now();
      const expiresAt = new Date(restoredAt.getTime() + RESTORED_INBOX_RETENTION_HOURS * 3_600_000);
      await tx`UPDATE bloombox.webhook_inbox SET payload_key_id = ${protectedPayload.keyId}, payload_ciphertext = ${protectedPayload.ciphertext},
        payload_purged_at = NULL, payload_expires_at = ${expiresAt}, status = 'PENDING', attempts = 0,
        available_at = ${restoredAt}, locked_at = NULL, locked_by = NULL WHERE id = ${row.id}`;
      await tx`INSERT INTO bloombox.audit_logs (id, actor_type, actor_reference, action, resource_type, resource_id, safe_metadata, occurred_at, idempotency_key)
        VALUES (${randomUUID()}, 'OPERATOR', ${`github:${request.requestedBy}`}, ${ACTION}, 'CommerceEvent', ${row.id},
        ${tx.json({ incidentIssue: request.incidentIssue, externalEventId: request.externalEventId, expiresAt: expiresAt.toISOString() })}, ${restoredAt}, ${key})`;
      return { outcome: "RESTORED" };
    });
  }
}
