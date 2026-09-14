import { randomUUID } from "node:crypto";
import type {
  FailedInboxRequeue,
  FailedInboxRequeueOutcome,
  FailedInboxRequeueRequest,
  FailedInboxRequeueResult,
} from "../application/requeue-failed-inbox-events";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";

const REQUEUE_ACTION = "provider.inbox.requeued";

/**
 * Requeues Stripe Inbox events that moved to FAILED. Each event is handled in its own transaction under a row lock,
 * so a concurrent worker claim or retention purge cannot interleave. Only FAILED rows whose encrypted payload is
 * still retained are reset; everything else is reported unchanged. No commerce state is written here.
 */
export class PostgresFailedInboxRequeue implements FailedInboxRequeue {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly providerAccountId?: string,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async execute(request: FailedInboxRequeueRequest): Promise<FailedInboxRequeueResult> {
    const requestedAt = this.now();
    const results: Array<{ externalEventId: string; outcome: FailedInboxRequeueOutcome }> = [];
    for (const externalEventId of request.externalEventIds) {
      results.push({ externalEventId, outcome: await this.requeue(externalEventId, request, requestedAt) });
    }
    return { results };
  }

  private async requeue(
    externalEventId: string,
    request: FailedInboxRequeueRequest,
    requestedAt: Date,
  ): Promise<FailedInboxRequeueOutcome> {
    return this.sql.begin(async (transaction): Promise<FailedInboxRequeueOutcome> => {
      const rows = await transaction`
        SELECT id, status, event_type, attempts, last_error_code, payload_purged_at
        FROM bloombox.webhook_inbox
        WHERE commerce_provider = 'STRIPE'
          AND (${this.providerAccountId ?? null}::text IS NULL OR provider_account_id = ${this.providerAccountId ?? null})
          AND external_event_id = ${externalEventId}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) return "NOT_FOUND";
      if (row.status !== "FAILED") return "NOT_FAILED";
      if (row.payload_purged_at !== null) return "PAYLOAD_PURGED";

      // The last error code is kept so the next failure or the audit can be compared with the original cause.
      await transaction`
        UPDATE bloombox.webhook_inbox
        SET status = 'PENDING', attempts = 0, available_at = ${requestedAt}, locked_at = NULL, locked_by = NULL
        WHERE id = ${row.id} AND status = 'FAILED'
      `;
      await transaction`
        INSERT INTO bloombox.audit_logs (
          id, actor_type, actor_reference, action, resource_type, resource_id, safe_metadata, occurred_at, idempotency_key
        ) VALUES (
          ${this.createId()}, 'OPERATOR', ${`github:${request.requestedBy}`}, ${REQUEUE_ACTION}, 'CommerceEvent', ${row.id},
          ${transaction.json({
            externalEventId,
            eventType: String(row.event_type),
            previousAttempts: Number(row.attempts),
            previousErrorCode: row.last_error_code === null ? null : String(row.last_error_code),
            incidentIssue: request.incidentIssue,
          })},
          ${requestedAt}, ${`inbox-requeue:${row.id}:${requestedAt.toISOString()}`}
        )
      `;
      return "REQUEUED";
    });
  }
}
