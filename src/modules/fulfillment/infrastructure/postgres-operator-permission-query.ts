import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { FulfillmentOperatorIdentity } from "../application/approve-shopify-fulfillment";
import { PermissionRevocationError } from "../application/revoke-operator-permission";
import { OPERATOR_PERMISSION_PAGE_SIZE, type OperatorPermissionListRequest, type OperatorPermissionList,
  type OperatorPermissionQuery } from "../application/read-operator-permissions";
import { PERMISSION_REVOCATION_REASONS } from "../domain/permission-revocation";

const shopSchema = z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/);
const inputSchema = z.object({ shop: shopSchema.optional(), cursor: z.uuid().optional() }).strict().refine((value) => !value.cursor || !!value.shop);
const integer = z.union([z.number(), z.string().regex(/^\d+$/), z.bigint()]).transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const rowSchema = z.object({ id: z.uuid(), operator_id: z.uuid(), enabled: z.boolean(), valid_until: z.date(), version: integer,
  revoked_by: z.uuid().nullable(), revoked_version: integer.nullable(), reason: z.enum(PERMISSION_REVOCATION_REASONS).nullable(), revoked_at: z.date().nullable() });

export class PostgresOperatorPermissionQuery implements OperatorPermissionQuery {
  constructor(private readonly sql: DatabaseClient, private readonly identity: FulfillmentOperatorIdentity) {}
  async list(input: OperatorPermissionListRequest): Promise<OperatorPermissionList> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new PermissionRevocationError("INVALID_REQUEST");
    const value = parsed.data;
    try {
      const actor = z.object({ operatorId: z.uuid(), expiresAt: z.date() }).safeParse(await this.identity.current());
      if (!actor.success) throw new PermissionRevocationError("NOT_AUTHORIZED");
      return await this.sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '1s'`;
        await tx`SET LOCAL statement_timeout = '2s'`;
        const [manager] = await tx`SELECT provider_scope, valid_until FROM bloombox.fulfillment_permission_managers
          WHERE operator_id = ${actor.data.operatorId} AND enabled AND created_at <= clock_timestamp() AND valid_until > clock_timestamp()
            AND (${value.shop ?? null}::text IS NULL OR provider_scope = ${value.shop ?? null})
          ORDER BY provider_scope LIMIT 1 FOR SHARE`;
        const check = async () => {
          const [clock] = await tx`SELECT clock_timestamp() AS now`;
          const now = z.date().parse(clock.now);
          if (!manager || z.date().parse(manager.valid_until) <= now || actor.data.expiresAt <= now) throw new PermissionRevocationError("NOT_AUTHORIZED");
          return now;
        };
        await check();
        const shop = shopSchema.parse(manager.provider_scope);
        const raw = await tx`SELECT permission.id, permission.operator_id, permission.enabled, permission.valid_until, permission.version,
          history.operator_id AS revoked_by, history.version AS revoked_version, history.reason, history.revoked_at
          FROM bloombox.fulfillment_operator_permissions AS permission
          LEFT JOIN LATERAL (SELECT operator_id, version, reason, revoked_at FROM bloombox.fulfillment_permission_revocations
            WHERE permission_id = permission.id ORDER BY version DESC LIMIT 1) AS history ON true
          WHERE permission.provider_scope = ${shop} AND (${value.cursor ?? null}::uuid IS NULL OR permission.id > ${value.cursor ?? null}::uuid)
          ORDER BY permission.id LIMIT ${OPERATOR_PERMISSION_PAGE_SIZE + 1}`;
        const viewedAt = await check();
        const rows = z.array(rowSchema).max(OPERATOR_PERMISSION_PAGE_SIZE + 1).parse(raw);
        const page = rows.slice(0, OPERATOR_PERMISSION_PAGE_SIZE);
        const last = page.at(-1);
        return { shop, viewedAt: viewedAt.toISOString(), nextCursor: rows.length > OPERATOR_PERMISSION_PAGE_SIZE && last ? last.id : null,
          entries: page.map((row) => ({ id: row.id, operatorId: row.operator_id, enabled: row.enabled, validUntil: row.valid_until.toISOString(), version: row.version,
            latestRevocation: row.revoked_by && row.revoked_version && row.reason && row.revoked_at
              ? { operatorId: row.revoked_by, version: row.revoked_version, reason: row.reason, revokedAt: row.revoked_at.toISOString() } : null })) };
      });
    } catch (error) {
      if (error instanceof PermissionRevocationError) throw error;
      throw new PermissionRevocationError("UNAVAILABLE");
    }
  }
}
