import { randomUUID } from "node:crypto";
import type { VerifiedProviderEvent, WebhookInbox } from "../application/receive-provider-webhook";
import type {
  FailedEventDisposition,
  ProviderEventQueue,
  ClaimedProviderEvent,
  ProviderEventReference,
} from "../application/process-provider-inbox";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { z } from "zod";

export const WEBHOOK_PAYLOAD_RETENTION_DAYS = 30;
export const WEBHOOK_MAX_PROCESSING_ATTEMPTS = 12;
export const WEBHOOK_MAX_RETRY_DELAY_SECONDS = 3_600;

// These NOT NULL identity columns are sufficient to record a failed restore under the same lease.
const eventReferenceSchema = z.object({
  commerce_provider: z.enum(["STRIPE", "SHOPIFY"]),
  provider_account_id: z.string(),
  external_event_id: z.string(),
});
const claimedEventSchema = eventReferenceSchema.extend({
  provider_account_id: z.string().min(1),
  external_event_id: z.string().min(1),
  event_type: z.string().min(1),
  external_object_id: z.string().nullable(),
  api_version: z.string().min(1),
  payload_key_id: z.string().min(1),
  payload_ciphertext: z.instanceof(Buffer),
  provider_occurred_at: z.union([z.string(), z.date()]).pipe(z.coerce.date()),
});

const providerPayloadSchema = z.record(z.string(), z.unknown());

export class WebhookInboxPersistenceError extends Error {
  constructor() {
    super("Provider event could not be persisted");
    this.name = "WebhookInboxPersistenceError";
  }
}

export class PostgresWebhookInbox implements WebhookInbox, ProviderEventQueue {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly protector: AesGcmDataProtector,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
    private readonly scope:
      | { provider: "SHOPIFY"; accountId: string }
      | { provider: "STRIPE"; accountId?: string } = { provider: "STRIPE" },
  ) {}

  async record(event: VerifiedProviderEvent): Promise<"INSERTED" | "DUPLICATE"> {
    this.assertScope(event);
    const payload = this.protector.protect(
      JSON.stringify(event.payload),
      webhookContext(event),
    );
    const receivedAt = this.now();
    const payloadExpiresAt = new Date(
      receivedAt.getTime() + WEBHOOK_PAYLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    try {
      const inserted = await this.sql`
        INSERT INTO bloombox.webhook_inbox (
          id, commerce_provider, provider_account_id, external_event_id, event_type,
          external_object_id, api_version, payload_key_id, payload_ciphertext,
          payload_expires_at, received_at, provider_occurred_at, available_at
        ) VALUES (
          ${this.createId()}, ${event.provider}, ${event.providerAccountId},
          ${event.externalEventId}, ${event.eventType}, ${event.externalObjectId ?? null},
          ${event.apiVersion}, ${payload.keyId}, ${payload.ciphertext},
          ${payloadExpiresAt}, ${receivedAt}, ${event.occurredAt}, ${receivedAt}
        )
        ON CONFLICT (commerce_provider, provider_account_id, external_event_id)
        DO NOTHING
        RETURNING id
      `;
      return inserted.length === 1 ? "INSERTED" : "DUPLICATE";
    } catch {
      throw new WebhookInboxPersistenceError();
    }
  }

  async claim(input: Readonly<{
    limit: number;
    workerId: string;
    now: Date;
    lockTimeoutMinutes: number;
  }>): Promise<readonly ClaimedProviderEvent[]> {
    if (
      !Number.isSafeInteger(input.limit)
      || input.limit < 1
      || input.limit > 1_000
      || !input.workerId
      || !Number.isSafeInteger(input.lockTimeoutMinutes)
      || input.lockTimeoutMinutes < 1
    ) {
      throw new WebhookInboxPersistenceError();
    }
    const staleBefore = new Date(input.now.getTime() - input.lockTimeoutMinutes * 60 * 1000);

    try {
      return await this.sql.begin(async (transaction) => {
        const rows = await transaction`
          WITH candidates AS (
            SELECT id
            FROM bloombox.webhook_inbox
            WHERE commerce_provider = ${this.scope.provider}
              AND (${this.scope.accountId ?? null}::text IS NULL OR provider_account_id = ${this.scope.accountId ?? null})
              AND (
                (status = 'PENDING' AND available_at <= ${input.now})
                OR (status = 'PROCESSING' AND locked_at <= ${staleBefore})
              )
            ORDER BY provider_occurred_at, received_at, id
            LIMIT ${input.limit}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE bloombox.webhook_inbox AS inbox
          SET status = 'PROCESSING', locked_at = ${input.now}, locked_by = ${input.workerId}
          FROM candidates
          WHERE inbox.id = candidates.id
          RETURNING
            inbox.commerce_provider,
            inbox.provider_account_id,
            inbox.external_event_id,
            inbox.event_type,
            inbox.external_object_id,
            inbox.api_version,
            inbox.payload_key_id,
            inbox.payload_ciphertext,
            inbox.provider_occurred_at
        `;
        return rows.map((untrustedRow) => this.restoreClaim(untrustedRow));
      });
    } catch (error) {
      if (error instanceof WebhookInboxPersistenceError) throw error;
      throw new WebhookInboxPersistenceError();
    }
  }

  async markProcessed(
    event: VerifiedProviderEvent,
    processedAt: Date,
    workerId: string,
  ): Promise<void> {
    this.assertScope(event);
    const updated = await this.sql`
      UPDATE bloombox.webhook_inbox
      SET
        status = 'PROCESSED',
        processed_at = ${processedAt},
        locked_at = NULL,
        locked_by = NULL,
        last_error_code = NULL
      WHERE commerce_provider = ${event.provider}
        AND provider_account_id = ${event.providerAccountId}
        AND external_event_id = ${event.externalEventId}
        AND status = 'PROCESSING'
        AND locked_by = ${workerId}
    `;
    if (updated.count !== 1) throw new WebhookInboxPersistenceError();
  }

  async markFailed(
    event: ProviderEventReference,
    errorCode: string,
    failedAt: Date,
    workerId: string,
  ): Promise<FailedEventDisposition> {
    this.assertScope(event);
    const updated = await this.sql`
      UPDATE bloombox.webhook_inbox
      SET
        status = CASE
          WHEN attempts + 1 >= ${WEBHOOK_MAX_PROCESSING_ATTEMPTS} THEN 'FAILED'
          ELSE 'PENDING'
        END,
        attempts = attempts + 1,
        available_at = ${failedAt} + (
          LEAST(POWER(2, attempts), ${WEBHOOK_MAX_RETRY_DELAY_SECONDS}) * interval '1 second'
        ),
        locked_at = NULL,
        locked_by = NULL,
        last_error_code = ${errorCode}
      WHERE commerce_provider = ${event.provider}
        AND provider_account_id = ${event.providerAccountId}
        AND external_event_id = ${event.externalEventId}
        AND status = 'PROCESSING'
        AND locked_by = ${workerId}
      RETURNING status
    `;
    if (updated.length !== 1) throw new WebhookInboxPersistenceError();
    return updated[0].status === "FAILED" ? "FAILED" : "RETRY_SCHEDULED";
  }

  private assertScope(event: Pick<VerifiedProviderEvent, "provider" | "providerAccountId">): void {
    if (event.provider !== this.scope.provider
      || (this.scope.accountId !== undefined && event.providerAccountId !== this.scope.accountId)) {
      throw new WebhookInboxPersistenceError();
    }
  }

  private restoreClaim(untrustedRow: unknown): ClaimedProviderEvent {
    const parsed = eventReferenceSchema.safeParse(untrustedRow);
    if (!parsed.success) throw new WebhookInboxPersistenceError();
    const reference: ProviderEventReference = {
      provider: parsed.data.commerce_provider, providerAccountId: parsed.data.provider_account_id,
      externalEventId: parsed.data.external_event_id,
    };
    this.assertScope(reference);
    try {
      return { kind: "READABLE", event: this.restoreEvent(untrustedRow) };
    } catch (error) {
      if (!(error instanceof WebhookInboxPersistenceError)) throw error;
      // Commit this record's lease alongside its neighbors. The worker applies the ordinary bounded retry policy.
      return { kind: "UNREADABLE", reference };
    }
  }

  private restoreEvent(untrustedRow: unknown): VerifiedProviderEvent {
    const row = claimedEventSchema.safeParse(untrustedRow);
    if (!row.success) throw new WebhookInboxPersistenceError();
    let payload: unknown;
    try {
      payload = JSON.parse(this.protector.unprotect({
        keyId: row.data.payload_key_id,
        ciphertext: row.data.payload_ciphertext,
      }, webhookContext({
        provider: row.data.commerce_provider,
        providerAccountId: row.data.provider_account_id,
        externalEventId: row.data.external_event_id,
      })));
    } catch {
      throw new WebhookInboxPersistenceError();
    }
    const parsedPayload = providerPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) throw new WebhookInboxPersistenceError();
    return {
      provider: row.data.commerce_provider,
      providerAccountId: row.data.provider_account_id,
      externalEventId: row.data.external_event_id,
      eventType: row.data.event_type,
      externalObjectId: row.data.external_object_id ?? undefined,
      apiVersion: row.data.api_version,
      occurredAt: row.data.provider_occurred_at,
      payload: parsedPayload.data,
    };
  }
}

function webhookContext(event: Pick<
  VerifiedProviderEvent,
  "provider" | "providerAccountId" | "externalEventId"
>): string {
  return `webhook:${event.provider}:${event.providerAccountId}:${event.externalEventId}:v1`;
}
