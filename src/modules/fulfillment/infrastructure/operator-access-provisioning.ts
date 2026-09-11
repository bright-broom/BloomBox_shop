import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { z } from "zod";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const requestSchema = z.object({
  changeId: uuid, database: z.string().regex(/^[a-zA-Z0-9_-]{1,63}$/),
  kind: z.enum(["APPROVER", "PERMISSION_MANAGER"]), permissionId: uuid, operatorId: uuid,
  shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  enabled: z.boolean(), validUntil: z.iso.datetime().transform((value) => new Date(value).toISOString()),
  reason: z.enum(["INITIAL_ASSIGNMENT", "ROLE_CHANGE", "ACCESS_RENEWAL", "SECURITY_RESPONSE"]),
}).strict();
export type OperatorAccessProvisioningRequest = z.input<typeof requestSchema>;
type Code = "INVALID_REQUEST" | "NOT_AUTHORIZED" | "WRONG_DATABASE" | "REVIEW_REQUIRED" | "CONFLICT" | "UNAVAILABLE";
export class OperatorAccessProvisioningError extends Error {
  readonly code: Code;
  constructor(code: Code) { super(`Operator access provisioning: ${code}`); this.code = code; this.name = "OperatorAccessProvisioningError"; }
}
const integer = z.union([z.number(), z.string().regex(/^\d+$/), z.bigint()]).transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const rowSchema = z.object({ id: z.uuid(), operator_id: z.uuid(), provider_scope: z.string(), enabled: z.boolean(),
  valid_until: z.date(), version: integer, created_at: z.date(), updated_at: z.date() });
const action = "fulfillment.operator_access.provisioned";
const definitions = {
  APPROVER: { table: "fulfillment_operator_permissions", resource: "FulfillmentPermission" },
  PERMISSION_MANAGER: { table: "fulfillment_permission_managers", resource: "FulfillmentPermissionManager" },
} as const;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function snapshot(row: z.infer<typeof rowSchema>) {
  return { id: row.id, operatorId: row.operator_id, shop: row.provider_scope, enabled: row.enabled,
    validUntil: row.valid_until.toISOString(), version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

/** Offline, DB-owner-only Fulfillment maintenance. Never compose with an HTTP route or application credential. */
export async function provisionOperatorAccess(sql: Sql, input: unknown, confirmation?: string) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success || (confirmation !== undefined && !/^[a-f0-9]{64}$/.test(confirmation))) {
    throw new OperatorAccessProvisioningError("INVALID_REQUEST");
  }
  const request = parsed.data, definition = definitions[request.kind];
  const applying = confirmation !== undefined;
  try {
    return await sql.begin(async (tx) => {
      if (!applying) await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      await tx`SET LOCAL search_path = pg_catalog`;
      await tx`SET LOCAL lock_timeout = '1s'`;
      await tx`SET LOCAL statement_timeout = '2s'`;
      const [authority] = await tx`SELECT current_database() AS database,
        pg_has_role(current_user, c.relowner, 'USAGE') AND pg_has_role(current_user, n.nspowner, 'USAGE') AS authorized
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'bloombox' AND c.relname = ${definition.table}`;
      if (!authority || authority.authorized !== true) throw new OperatorAccessProvisioningError("NOT_AUTHORIZED");
      if (authority.database !== request.database) throw new OperatorAccessProvisioningError("WRONG_DATABASE");
      const [guard] = await tx`SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'bloombox.audit_logs'::regclass AND tgname = 'operator_provisioning_audit_protected'
          AND tgenabled IN ('O', 'A')) AS enabled`;
      if (guard?.enabled !== true) throw new OperatorAccessProvisioningError("UNAVAILABLE");
      if (applying) {
        // Serialize absent-row creation and same-key retries before taking the permission row lock.
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`operator-access-change:${request.changeId}`}, 0))`;
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`operator-access-target:${request.kind}:${request.operatorId}:${request.shop}`}, 0))`;
      }
      const rows = applying
        ? await tx`SELECT * FROM bloombox.${tx(definition.table)} WHERE id = ${request.permissionId}
          OR (operator_id = ${request.operatorId} AND provider_scope = ${request.shop}) FOR UPDATE`
        : await tx`SELECT * FROM bloombox.${tx(definition.table)} WHERE id = ${request.permissionId}
          OR (operator_id = ${request.operatorId} AND provider_scope = ${request.shop})`;
      if (rows.length > 1) throw new OperatorAccessProvisioningError("CONFLICT");
      const current = rows[0] ? rowSchema.parse(rows[0]) : null;
      if (current && (current.id !== request.permissionId || current.operator_id !== request.operatorId || current.provider_scope !== request.shop)) {
        throw new OperatorAccessProvisioningError("CONFLICT");
      }
      const [prior] = await tx`SELECT action, resource_type, resource_id, safe_metadata FROM bloombox.audit_logs WHERE id = ${request.changeId}`;
      if (prior) {
        if (prior.action !== action || prior.resource_type !== definition.resource || prior.resource_id !== request.permissionId) {
          throw new OperatorAccessProvisioningError("CONFLICT");
        }
        const metadata = z.object({ request: requestSchema, planHash: z.string().regex(/^[a-f0-9]{64}$/), after: z.unknown() }).parse(prior.safe_metadata);
        if (digest(metadata.request) !== digest(request) || (applying && metadata.planHash !== confirmation)) {
          throw new OperatorAccessProvisioningError("CONFLICT");
        }
        if (!current || digest(snapshot(current)) !== digest(metadata.after)) throw new OperatorAccessProvisioningError("REVIEW_REQUIRED");
        return { outcome: "DUPLICATE" as const, changeId: request.changeId, planHash: metadata.planHash, current: snapshot(current) };
      }
      if ((current?.version ?? 0) !== request.expectedVersion) throw new OperatorAccessProvisioningError("REVIEW_REQUIRED");
      const [clock] = await tx`SELECT clock_timestamp() AS now`;
      const now = z.date().parse(clock.now), until = new Date(request.validUntil);
      if ((request.enabled && until <= now) || until <= (current?.created_at ?? now)
        || (current && (current.created_at > now || current.updated_at > now))) {
        throw new OperatorAccessProvisioningError("REVIEW_REQUIRED");
      }
      const before = current ? snapshot(current) : null;
      const proposed = { permissionId: request.permissionId, operatorId: request.operatorId, shop: request.shop,
        enabled: request.enabled, validUntil: request.validUntil, version: request.expectedVersion + 1 };
      const planHash = digest({ request, before });
      if (!applying) return { outcome: "PLAN" as const, request, before, proposed, planHash };
      if (confirmation !== planHash) throw new OperatorAccessProvisioningError("REVIEW_REQUIRED");
      const changed = current
        ? await tx`UPDATE bloombox.${tx(definition.table)} SET enabled = ${request.enabled}, valid_until = ${until},
          version = version + 1, updated_at = ${now} WHERE id = ${request.permissionId} AND version = ${request.expectedVersion} RETURNING *`
        : await tx`INSERT INTO bloombox.${tx(definition.table)} (id, operator_id, provider_scope, enabled, valid_until, created_at, updated_at)
          VALUES (${request.permissionId}, ${request.operatorId}, ${request.shop}, ${request.enabled}, ${until}, ${now}, ${now}) RETURNING *`;
      if (changed.length !== 1) throw new OperatorAccessProvisioningError("CONFLICT");
      const after = snapshot(rowSchema.parse(changed[0]));
      await tx`INSERT INTO bloombox.audit_logs (id, actor_type, actor_reference, action, resource_type, resource_id, safe_metadata, occurred_at)
        VALUES (${request.changeId}, 'SYSTEM', 'operator-access-provisioning', ${action}, ${definition.resource}, ${request.permissionId},
          ${tx.json({ request, before, after, planHash })}, ${now})`;
      // An expiry crossed while waiting for audit writes must roll the entire change back.
      const [finished] = await tx`SELECT clock_timestamp() AS now`;
      if (request.enabled && until <= z.date().parse(finished.now)) throw new OperatorAccessProvisioningError("REVIEW_REQUIRED");
      return { outcome: "APPLIED" as const, changeId: request.changeId, planHash, current: after };
    });
  } catch (error) {
    if (error instanceof OperatorAccessProvisioningError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new OperatorAccessProvisioningError("CONFLICT");
    throw new OperatorAccessProvisioningError("UNAVAILABLE");
  }
}
