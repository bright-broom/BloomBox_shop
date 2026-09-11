import { z } from "zod";
import { PermissionRevocationError, PERMISSION_REVOCATION_REASONS, type OperatorPermissionListRequest,
  type PermissionManagementPage } from "@/modules/fulfillment/public";
import { PostgresOperatorPermissionQuery } from "@/modules/fulfillment/infrastructure/postgres-operator-permission-query";
import { PostgresOperatorPermissionRevoker } from "@/modules/fulfillment/infrastructure/postgres-operator-permission-revoker";
import { PostgresApprovalSubmissionLimiter } from "@/modules/fulfillment/infrastructure/postgres-approval-submission-limiter";
import { getPermissionManagerDatabaseClient } from "../../database/database-connections";
import { getOperatorAuth } from "./operator-auth";
import { GoogleFulfillmentOperatorIdentity } from "./google-operator-identity";
import { OperatorRevocationIntent } from "./revocation-intent";

async function managerContext(origin?: string | null) {
  const service = getOperatorAuth();
  if (!service || (origin !== undefined && origin !== service.config.origin)) throw new PermissionRevocationError("NOT_AUTHORIZED");
  const session = await service.auth.auth();
  const identity = new GoogleFulfillmentOperatorIdentity(async () => session, service.config.bindings);
  const actor = await identity.current();
  if (!actor) throw new PermissionRevocationError("NOT_AUTHORIZED");
  return { service, identity, actor };
}

export async function preparePermissionManagement(input: OperatorPermissionListRequest): Promise<PermissionManagementPage> {
  const { service, identity, actor } = await managerContext();
  const list = await new PostgresOperatorPermissionQuery(getPermissionManagerDatabaseClient(), identity).list(input);
  const issuer = new OperatorRevocationIntent(service.config.secret, service.config.origin);
  const entries = await Promise.all(list.entries.map(async (entry) => ({ ...entry, intent: entry.enabled
    ? await issuer.issue({ shop: list.shop, permissionId: entry.id, reviewedVersion: entry.version }, actor, service.config.testMode) : null })));
  return { ...list, entries };
}

export async function revokeOperatorPermission(form: FormData, origin: string | null) {
  if (typeof origin !== "string") throw new PermissionRevocationError("NOT_AUTHORIZED");
  const { service, identity, actor } = await managerContext(origin);
  const token = form.get("intent");
  const reason = z.enum(PERMISSION_REVOCATION_REASONS).safeParse(form.get("reason"));
  if (typeof token !== "string" || token.length > 2048 || !reason.success || form.get("acknowledged") !== "yes"
    || ["intent", "reason", "acknowledged"].some((key) => form.getAll(key).length !== 1)
    || [...form.keys()].some((key) => !["intent", "reason", "acknowledged"].includes(key) && !key.startsWith("$ACTION_"))) {
    throw new PermissionRevocationError("INVALID_REQUEST");
  }
  const database = getPermissionManagerDatabaseClient();
  // The existing operator allowance covers both approval and permission-revocation work.
  await new PostgresApprovalSubmissionLimiter(database, identity).consume();
  const request = await new OperatorRevocationIntent(service.config.secret, service.config.origin).read(token, actor, service.config.testMode);
  const receipt = await new PostgresOperatorPermissionRevoker(database, identity).revoke({ ...request, reason: reason.data });
  return { outcome: receipt.outcome };
}
