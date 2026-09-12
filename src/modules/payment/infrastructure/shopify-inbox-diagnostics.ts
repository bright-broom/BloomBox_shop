import type { Sql } from "postgres";
import { z } from "zod";

export const SHOPIFY_INBOX_DIAGNOSTIC_LIMIT = 10_000;
const requestSchema = z.object({
  shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  maxPendingAgeSeconds: z.number().int().min(1).max(2_592_000),
  lockTimeoutMinutes: z.number().int().min(1).max(60),
}).strict();
const count = z.number().int().min(0).max(SHOPIFY_INBOX_DIAGNOSTIC_LIMIT + 1);
const summarySchema = z.object({
  checked_at: z.date(), oldest_pending_at: z.date().nullable(),
  observed: count, pending: count, ready: count, scheduled: count, retrying: count,
  processing: count, stalled: count, failed: count, expired_payloads: count,
  missing_payloads: count, invalid_times: count,
  configuration_holds: count, terms_holds: count, payment_holds: count, pricing_holds: count,
  delivery_holds: count, order_holds: count, incomplete_holds: count, unknown_failures: count, no_failures: count,
}).refine((row) => row.observed === row.pending + row.processing + row.failed
  && row.pending === row.ready + row.scheduled && row.retrying <= row.pending
  && row.stalled <= row.processing && row.expired_payloads <= row.observed
  && row.missing_payloads <= row.observed && row.invalid_times <= row.observed
  && row.configuration_holds + row.terms_holds + row.payment_holds + row.pricing_holds
    + row.delivery_holds + row.order_holds + row.incomplete_holds + row.unknown_failures + row.no_failures === row.observed
  && (row.oldest_pending_at !== null) === (row.pending > 0));

export class ShopifyInboxDiagnosticError extends Error {
  readonly code: "INVALID_REQUEST" | "UNAVAILABLE";
  constructor(code: "INVALID_REQUEST" | "UNAVAILABLE") {
    super(`Shopify Inbox diagnostic: ${code}`);
    this.code = code;
    this.name = "ShopifyInboxDiagnosticError";
  }
}

/** Offline metadata-only inspection. Never claims, decrypts, requeues, or completes an event. */
export async function inspectShopifyInbox(sql: Sql, input: unknown) {
  const request = requestSchema.safeParse(input);
  if (!request.success) throw new ShopifyInboxDiagnosticError("INVALID_REQUEST");
  const { shop, maxPendingAgeSeconds, lockTimeoutMinutes } = request.data;
  try {
    return await sql.begin("READ ONLY", async (transaction) => {
      await transaction`SET LOCAL search_path = pg_catalog`;
      await transaction`SET LOCAL statement_timeout = '2s'`;
      await transaction`SET LOCAL lock_timeout = '1s'`;
      const rows = await transaction`
        WITH sample AS MATERIALIZED (
          SELECT status, available_at, locked_at, received_at, payload_expires_at, payload_purged_at, attempts, category
          FROM bloombox.shopify_inbox_diagnostic_metadata
          WHERE provider_account_id = ${shop}
            AND status IN ('PENDING', 'PROCESSING', 'FAILED')
          ORDER BY received_at, id
          LIMIT ${SHOPIFY_INBOX_DIAGNOSTIC_LIMIT + 1}
        )
        SELECT statement_timestamp() AS checked_at,
          MIN(received_at) FILTER (WHERE status = 'PENDING') AS oldest_pending_at,
          COUNT(*)::int AS observed,
          COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'PENDING' AND available_at <= statement_timestamp())::int AS ready,
          COUNT(*) FILTER (WHERE status = 'PENDING' AND available_at > statement_timestamp())::int AS scheduled,
          COUNT(*) FILTER (WHERE status = 'PENDING' AND attempts > 0)::int AS retrying,
          COUNT(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
          COUNT(*) FILTER (WHERE status = 'PROCESSING' AND (locked_at IS NULL
            OR locked_at <= statement_timestamp() - ${lockTimeoutMinutes} * interval '1 minute'))::int AS stalled,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
          COUNT(*) FILTER (WHERE payload_purged_at IS NULL AND payload_expires_at <= statement_timestamp())::int AS expired_payloads,
          COUNT(*) FILTER (WHERE payload_purged_at IS NOT NULL)::int AS missing_payloads,
          COUNT(*) FILTER (WHERE received_at > statement_timestamp()
            OR (status = 'PROCESSING' AND locked_at > statement_timestamp()))::int AS invalid_times,
          COUNT(*) FILTER (WHERE category = 'CONFIGURATION')::int AS configuration_holds,
          COUNT(*) FILTER (WHERE category = 'TERMS')::int AS terms_holds,
          COUNT(*) FILTER (WHERE category = 'PAYMENT')::int AS payment_holds,
          COUNT(*) FILTER (WHERE category = 'PRICING')::int AS pricing_holds,
          COUNT(*) FILTER (WHERE category = 'DELIVERY')::int AS delivery_holds,
          COUNT(*) FILTER (WHERE category = 'ORDER')::int AS order_holds,
          COUNT(*) FILTER (WHERE category = 'INCOMPLETE')::int AS incomplete_holds,
          COUNT(*) FILTER (WHERE category = 'UNKNOWN')::int AS unknown_failures,
          COUNT(*) FILTER (WHERE category = 'NONE')::int AS no_failures
        FROM sample
      `;
      const parsed = summarySchema.safeParse(rows.length === 1 ? rows[0] : null);
      if (!parsed.success) throw new ShopifyInboxDiagnosticError("UNAVAILABLE");
      const row = parsed.data;
      const oldestPendingAgeSeconds = row.oldest_pending_at === null ? null
        : Math.max(0, Math.floor((row.checked_at.getTime() - row.oldest_pending_at.getTime()) / 1_000));
      const reasons: string[] = [];
      const truncated = row.observed > SHOPIFY_INBOX_DIAGNOSTIC_LIMIT;
      if (truncated) reasons.push("SCAN_LIMIT_REACHED");
      if (oldestPendingAgeSeconds !== null && oldestPendingAgeSeconds >= maxPendingAgeSeconds) reasons.push("PENDING_TOO_OLD");
      if (row.failed > 0) reasons.push("FAILED_EVENTS");
      if (row.stalled > 0) reasons.push("STALE_CLAIMS");
      if (row.expired_payloads > 0) reasons.push("PAYLOAD_RETENTION_EXCEEDED");
      if (row.missing_payloads > 0) reasons.push("PAYLOAD_UNAVAILABLE");
      if (row.invalid_times > 0) reasons.push("INVALID_TIMESTAMPS");
      if (row.configuration_holds + row.terms_holds + row.pricing_holds + row.delivery_holds + row.order_holds > 0) {
        reasons.push("COMMERCE_REVIEW_REQUIRED");
      }
      return {
        provider: "SHOPIFY" as const, shop, checkedAt: row.checked_at.toISOString(),
        status: reasons.length ? "ATTENTION" as const : row.observed ? "WITHIN_LIMITS" as const : "EMPTY" as const,
        coverage: truncated ? "LOWER_BOUND" as const : "COMPLETE" as const,
        maxPendingAgeSeconds, lockTimeoutMinutes, oldestPendingAgeSeconds,
        counts: { observed: row.observed, pending: row.pending, ready: row.ready, scheduled: row.scheduled,
          retrying: row.retrying, processing: row.processing, stalled: row.stalled, failed: row.failed,
          expiredPayloads: row.expired_payloads, missingPayloads: row.missing_payloads, invalidTimes: row.invalid_times },
        lastFailureCategories: { configuration: row.configuration_holds, terms: row.terms_holds, payment: row.payment_holds,
          pricing: row.pricing_holds, delivery: row.delivery_holds, order: row.order_holds, incomplete: row.incomplete_holds,
          unknown: row.unknown_failures, none: row.no_failures },
        reasons,
      };
    });
  } catch {
    // Driver messages can contain connection details or SQL parameters. Only fixed diagnostic codes leave this boundary.
    throw new ShopifyInboxDiagnosticError("UNAVAILABLE");
  }
}
