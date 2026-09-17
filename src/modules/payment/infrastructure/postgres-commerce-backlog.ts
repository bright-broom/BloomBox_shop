import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";

export const COMMERCE_BACKLOG_PAGE_SIZE = 50;
const cursorSchema = z.string().uuid().optional();
const count = z.number().int().nonnegative();
const entrySchema = z.object({ id: z.string().uuid(), external_event_id: z.string().regex(/^evt_[A-Za-z0-9]+$/),
  status: z.enum(["PENDING", "PROCESSING", "FAILED"]), attempts: count, received_at: z.date(),
  payload_retained: z.boolean(), payload_expires_at: z.date() });
const inboxSummary = z.object({ status: z.enum(["PENDING", "PROCESSING", "FAILED"]), count, oldest_at: z.date(), purged_count: count });
const outboxSummary = z.object({ status: z.enum(["PENDING", "FAILED"]), count, oldest_at: z.date() });

/** Metadata only. Outbox has no provider-account key, so its explicitly global totals cannot be presented as account scoped. */
export class PostgresCommerceBacklog {
  constructor(private readonly sql: DatabaseClient, private readonly accountId: string) {}
  async execute(after?: string) {
    const cursor = cursorSchema.parse(after);
    return this.sql.begin("isolation level repeatable read read only", async (tx) => {
      await tx`SET LOCAL statement_timeout = '10s'`;
      const inbox = await tx`SELECT status, count(*)::int AS count, min(received_at) AS oldest_at,
        count(*) FILTER (WHERE payload_purged_at IS NOT NULL)::int AS purged_count
        FROM bloombox.webhook_inbox WHERE commerce_provider = 'STRIPE' AND provider_account_id = ${this.accountId}
        AND status IN ('PENDING', 'PROCESSING', 'FAILED') GROUP BY status ORDER BY status`;
      const outbox = await tx`SELECT status, count(*)::int AS count, min(occurred_at) AS oldest_at
        FROM bloombox.outbox_events WHERE status IN ('PENDING', 'FAILED') GROUP BY status ORDER BY status`;
      const rows = await tx`SELECT id, external_event_id, status, attempts, received_at,
        payload_purged_at IS NULL AS payload_retained, payload_expires_at
        FROM bloombox.webhook_inbox WHERE commerce_provider = 'STRIPE' AND provider_account_id = ${this.accountId}
        AND status IN ('PENDING', 'PROCESSING', 'FAILED') AND (${cursor ?? null}::uuid IS NULL OR id > ${cursor ?? null}::uuid)
        ORDER BY id LIMIT ${COMMERCE_BACKLOG_PAGE_SIZE + 1}`;
      const entries = z.array(entrySchema).parse(rows).slice(0, COMMERCE_BACKLOG_PAGE_SIZE);
      return { inbox: { scope: "CONFIGURED_STRIPE_ACCOUNT" as const, summary: z.array(inboxSummary).parse(inbox), entries,
        nextCursor: rows.length > COMMERCE_BACKLOG_PAGE_SIZE ? entries.at(-1)?.id ?? null : null },
      outbox: { scope: "ALL_PROVIDERS" as const, summary: z.array(outboxSummary).parse(outbox) } };
    });
  }
}
