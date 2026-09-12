import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { z } from "zod";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const requestSchema = z.object({
  changeId: uuid, database: z.string().regex(/^[a-zA-Z0-9_-]{1,63}$/), inboxId: uuid,
  provider: z.enum(["SHOPIFY", "STRIPE"]), accountId: z.string().max(255),
  reviewExpiresAt: z.iso.datetime().transform((value) => new Date(value).toISOString()),
  reason: z.enum(["KEYS_RESTORED", "DEPENDENCY_RECOVERED", "PROVIDER_RECONCILED"]),
}).strict().refine((request) => request.provider === "SHOPIFY"
  ? /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(request.accountId) : /^acct_[A-Za-z0-9]+$/.test(request.accountId));
export type WebhookRetryRequest = z.input<typeof requestSchema>;
export const WEBHOOK_RETRY_REVIEW_MAX_SECONDS = 600;
type Code = "INVALID_REQUEST" | "NOT_AUTHORIZED" | "WRONG_DATABASE" | "NOT_FOUND" | "REVIEW_REQUIRED" | "CONFLICT" | "UNAVAILABLE";
export class WebhookRetryError extends Error {
  readonly code: Code;
  constructor(code: Code) { super(`Webhook retry: ${code}`); this.code = code; this.name = "WebhookRetryError"; }
}
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const rowSchema = z.object({
  id: z.uuid(), commerce_provider: z.enum(["SHOPIFY", "STRIPE"]), provider_account_id: z.string(),
  external_event_id: z.string().min(1), external_object_id: z.string().nullable(), event_type: z.string().min(1), api_version: z.string().min(1),
  status: z.enum(["PENDING", "PROCESSING", "PROCESSED", "FAILED"]), attempts: z.number().int().nonnegative(),
  received_at: z.date(), available_at: z.date(), provider_occurred_at: z.date(), payload_expires_at: z.date(),
  locked_at: z.date().nullable(), locked_by: z.string().nullable(), processed_at: z.date().nullable(),
  payload_purged_at: z.date().nullable(), payload_key_id: z.string().nullable(), payload_hash: fingerprint.nullable(),
  payload_bytes: z.number().int().nonnegative().nullable(), last_error_code: z.string().nullable(),
});
const action = "payment.webhook.retry_requested";
// All values passed here are schema-ordered objects or explicit snapshots; dates serialize to ISO strings.
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function snapshot(row: z.infer<typeof rowSchema>) {
  return { inboxId: row.id, provider: row.commerce_provider, accountId: row.provider_account_id,
    status: row.status, attempts: row.attempts, receivedAt: row.received_at.toISOString(),
    availableAt: row.available_at.toISOString(), payloadExpiresAt: row.payload_expires_at.toISOString() };
}

/** Offline DB-owner command. No decryption, provider call, event clone or commerce transition. */
export async function retryProviderWebhook(sql: Sql, input: unknown, confirmation?: string) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success || (confirmation !== undefined && !fingerprint.safeParse(confirmation).success)) throw new WebhookRetryError("INVALID_REQUEST");
  const request = parsed.data, applying = confirmation !== undefined;
  try {
    return await sql.begin(async (tx) => {
      if (!applying) await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      await tx`SET LOCAL search_path = pg_catalog`;
      await tx`SET LOCAL lock_timeout = '1s'`;
      await tx`SET LOCAL statement_timeout = '2s'`;
      const [authority] = await tx`SELECT current_database() AS database,
        pg_has_role(current_user, c.relowner, 'USAGE') AND pg_has_role(current_user, n.nspowner, 'USAGE') AS authorized
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'bloombox' AND c.relname = 'webhook_inbox'`;
      if (authority?.authorized !== true) throw new WebhookRetryError("NOT_AUTHORIZED");
      if (authority.database !== request.database) throw new WebhookRetryError("WRONG_DATABASE");
      const [guard] = await tx`SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'bloombox.audit_logs'::regclass AND tgname = 'webhook_retry_audit_protected'
          AND tgenabled IN ('O', 'A')) AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'bloombox.webhook_inbox'::regclass AND tgname = 'webhook_failed_retry_protected'
          AND tgenabled IN ('O', 'A')) AS enabled`;
      if (guard?.enabled !== true) throw new WebhookRetryError("UNAVAILABLE");
      if (applying) await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`webhook-retry:${request.changeId}`}, 0))`;
      // A committed receipt is authoritative even after the worker advances or purges the original record.
      const [prior] = await tx`SELECT action, resource_type, resource_id, safe_metadata FROM bloombox.audit_logs WHERE id = ${request.changeId}`;
      if (prior) {
        if (prior.action !== action || prior.resource_type !== "WebhookInbox" || prior.resource_id !== request.inboxId) throw new WebhookRetryError("CONFLICT");
        const receipt = z.object({ request: requestSchema, planHash: fingerprint, requeuedAt: z.iso.datetime() }).parse(prior.safe_metadata);
        if (digest(receipt.request) !== digest(request) || (applying && receipt.planHash !== confirmation)) throw new WebhookRetryError("CONFLICT");
        return { outcome: "DUPLICATE" as const, changeId: request.changeId, inboxId: request.inboxId,
          planHash: receipt.planHash, requeuedAt: receipt.requeuedAt };
      }
      // Selecting only required columns keeps ciphertext and arbitrary provider payloads out of this process.
      const rows = await tx`
        SELECT id, commerce_provider, provider_account_id, external_event_id, external_object_id, event_type, api_version,
          status, attempts, received_at, available_at, provider_occurred_at, payload_expires_at,
          locked_at, locked_by, processed_at, payload_purged_at, payload_key_id, last_error_code,
          encode(sha256(payload_ciphertext), 'hex') AS payload_hash, octet_length(payload_ciphertext) AS payload_bytes
        FROM bloombox.webhook_inbox
        WHERE id = ${request.inboxId} AND commerce_provider = ${request.provider} AND provider_account_id = ${request.accountId}
        ${applying ? tx`FOR UPDATE` : tx``}
      `;
      if (rows.length !== 1) throw new WebhookRetryError("NOT_FOUND");
      const checked = rowSchema.safeParse(rows[0]);
      if (!checked.success) throw new WebhookRetryError("REVIEW_REQUIRED");
      const row = checked.data;
      const [clock] = await tx`SELECT clock_timestamp() AS now`;
      const now = z.date().parse(clock.now), expiresAt = new Date(request.reviewExpiresAt);
      if (row.status !== "FAILED" || row.attempts < 1 || row.locked_at !== null || row.locked_by !== null
        || row.processed_at !== null || row.payload_purged_at !== null || !row.payload_key_id || !row.payload_hash || !row.payload_bytes
        || row.received_at > now || row.provider_occurred_at > now || row.payload_expires_at <= now
        || expiresAt <= now || expiresAt.getTime() > now.getTime() + WEBHOOK_RETRY_REVIEW_MAX_SECONDS * 1_000) {
        throw new WebhookRetryError("REVIEW_REQUIRED");
      }
      const before = snapshot(row), planHash = digest({ request, row });
      const proposed = { inboxId: request.inboxId, status: "PENDING" as const, attempts: 0, availableAt: "APPLY_TIME" as const };
      if (!applying) return { outcome: "PLAN" as const, request, before, proposed, planHash };
      if (confirmation !== planHash) throw new WebhookRetryError("REVIEW_REQUIRED");
      const updated = await tx`UPDATE bloombox.webhook_inbox SET status = 'PENDING', attempts = 0, available_at = ${now}
        WHERE id = ${request.inboxId} AND status = 'FAILED' RETURNING id`;
      if (updated.length !== 1) throw new WebhookRetryError("CONFLICT");
      const after = { ...before, status: "PENDING", attempts: 0, availableAt: now.toISOString() };
      await tx`INSERT INTO bloombox.audit_logs (id, actor_type, actor_reference, action, resource_type, resource_id, safe_metadata, occurred_at)
        VALUES (${request.changeId}, 'SYSTEM', 'webhook-retry', ${action}, 'WebhookInbox', ${request.inboxId},
          ${tx.json({ request, before, after, planHash, requeuedAt: now.toISOString() })}, ${now})`;
      const [finished] = await tx`SELECT clock_timestamp() AS now`;
      const finishedAt = z.date().parse(finished.now);
      if (expiresAt <= finishedAt || row.payload_expires_at <= finishedAt) throw new WebhookRetryError("REVIEW_REQUIRED");
      return { outcome: "APPLIED" as const, changeId: request.changeId, inboxId: request.inboxId, planHash, requeuedAt: now.toISOString() };
    });
  } catch (error) {
    if (error instanceof WebhookRetryError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new WebhookRetryError("CONFLICT");
    throw new WebhookRetryError("UNAVAILABLE");
  }
}
