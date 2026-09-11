import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseClient, DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import type { FulfillmentOperatorIdentity } from "../application/approve-shopify-fulfillment";
import { PermissionRevocationError, type OperatorPermissionRevoker, type PermissionRevocationRequest,
  type PermissionRevocationReceipt } from "../application/revoke-operator-permission";
import { PERMISSION_REVOCATION_REASONS } from "../domain/permission-revocation";

const integer = z.union([z.number(), z.string().regex(/^\d+$/), z.bigint()]).transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const requestSchema = z.object({ shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  permissionId: z.uuid(), reviewedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1),
  reason: z.enum(PERMISSION_REVOCATION_REASONS), idempotencyKey: z.uuid() }).strict();
const actorSchema = z.object({ operatorId: z.uuid(), expiresAt: z.date() });
async function databaseTime(tx: DatabaseTransaction) {
  const [row] = await tx`SELECT clock_timestamp() AS now`;
  return z.date().parse(row?.now);
}

/** Internal command: compose only with a verified session and a dedicated manager credential. */
export class PostgresOperatorPermissionRevoker implements OperatorPermissionRevoker {
  constructor(private readonly sql: DatabaseClient,
    private readonly identity: FulfillmentOperatorIdentity = { current: async () => null }) {}

  async revoke(input: PermissionRevocationRequest): Promise<PermissionRevocationReceipt> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new PermissionRevocationError("INVALID_REQUEST");
    const value = parsed.data;
    try {
      const authenticated = actorSchema.safeParse(await this.identity.current());
      if (!authenticated.success) throw new PermissionRevocationError("NOT_AUTHORIZED");
      const actor = authenticated.data;
      return await this.sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '1s'`;
        await tx`SET LOCAL statement_timeout = '2s'`;
        const [manager] = await tx`SELECT * FROM bloombox.fulfillment_permission_managers
          WHERE operator_id = ${actor.operatorId} AND provider_scope = ${value.shop} FOR SHARE`;
        const authorize = (now: Date) => {
          if (!manager || manager.enabled !== true || z.date().parse(manager.created_at) > now
            || z.date().parse(manager.valid_until) <= now || actor.expiresAt <= now) {
            throw new PermissionRevocationError("NOT_AUTHORIZED");
          }
        };
        authorize(await databaseTime(tx));
        const [permission] = await tx`SELECT * FROM bloombox.fulfillment_operator_permissions
          WHERE id = ${value.permissionId} AND provider_scope = ${value.shop} FOR UPDATE`;
        authorize(await databaseTime(tx));
        if (!permission) throw new PermissionRevocationError("REVIEW_REQUIRED");
        const existing = await tx`SELECT * FROM bloombox.fulfillment_permission_revocations
          WHERE (operator_id = ${actor.operatorId} AND idempotency_key = ${value.idempotencyKey})
            OR (permission_id = ${value.permissionId} AND previous_version = ${value.reviewedVersion})`;
        if (existing.length > 1) throw new PermissionRevocationError("CONFLICT");
        const previous = existing[0];
        if (previous) {
          if (previous.operator_id !== actor.operatorId || previous.idempotency_key !== value.idempotencyKey
            || previous.permission_id !== value.permissionId || integer.parse(previous.previous_version) !== value.reviewedVersion
            || previous.reason !== value.reason || previous.manager_id !== manager.id
            || integer.parse(previous.manager_version) !== integer.parse(manager.version)) {
            throw new PermissionRevocationError("CONFLICT");
          }
          if (permission.enabled || integer.parse(permission.version) !== integer.parse(previous.version)) {
            throw new PermissionRevocationError("REVIEW_REQUIRED");
          }
          authorize(await databaseTime(tx));
          return { outcome: "DUPLICATE", revocationId: z.uuid().parse(previous.id), permissionId: value.permissionId,
            previousVersion: value.reviewedVersion, version: integer.parse(previous.version), revokedAt: z.date().parse(previous.revoked_at) };
        }
        if (!permission.enabled || integer.parse(permission.version) !== value.reviewedVersion) throw new PermissionRevocationError("REVIEW_REQUIRED");
        const [changed] = await tx`SELECT * FROM bloombox.disable_fulfillment_permission(${value.permissionId}::uuid, ${value.reviewedVersion}::bigint)`;
        if (!changed || integer.parse(changed.version) !== value.reviewedVersion + 1) throw new PermissionRevocationError("CONFLICT");
        const revokedAt = z.date().parse(changed.updated_at);
        authorize(revokedAt);
        const revocationId = randomUUID();
        await tx`INSERT INTO bloombox.fulfillment_permission_revocations
          (id, permission_id, previous_version, version, manager_id, manager_version, operator_id, idempotency_key, reason, revoked_at)
          VALUES (${revocationId}, ${value.permissionId}, ${value.reviewedVersion}, ${changed.version}, ${manager.id}, ${manager.version},
            ${actor.operatorId}, ${value.idempotencyKey}, ${value.reason}, ${revokedAt})`;
        const metadata = { revocationId, shop: value.shop, previousVersion: value.reviewedVersion, version: integer.parse(changed.version),
          managerId: z.uuid().parse(manager.id), managerVersion: integer.parse(manager.version), reason: value.reason };
        await tx`INSERT INTO bloombox.audit_logs (id, actor_type, actor_reference, action, resource_type, resource_id, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'OPERATOR', ${actor.operatorId}, 'fulfillment.operator_permission.revoked', 'FulfillmentPermission',
            ${value.permissionId}, ${tx.json(metadata)}, ${revokedAt})`;
        authorize(await databaseTime(tx));
        return { outcome: "REVOKED", revocationId, permissionId: value.permissionId,
          previousVersion: value.reviewedVersion, version: integer.parse(changed.version), revokedAt };
      });
    } catch (error) {
      if (error instanceof PermissionRevocationError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new PermissionRevocationError("CONFLICT");
      throw new PermissionRevocationError("UNAVAILABLE");
    }
  }
}
