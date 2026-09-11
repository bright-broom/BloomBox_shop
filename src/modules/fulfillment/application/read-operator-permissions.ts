import type { PermissionRevocationReason } from "../domain/permission-revocation";
export const OPERATOR_PERMISSION_PAGE_SIZE = 20;
export type OperatorPermissionListRequest = Readonly<{ shop?: string; cursor?: string }>;
export type OperatorPermissionList = Readonly<{
  shop: string; viewedAt: string; nextCursor: string | null;
  entries: ReadonlyArray<Readonly<{
    id: string; operatorId: string; enabled: boolean; validUntil: string; version: number;
    latestRevocation: Readonly<{ operatorId: string; version: number; reason: PermissionRevocationReason; revokedAt: string }> | null;
  }>>;
}>;
export interface OperatorPermissionQuery { list(input: OperatorPermissionListRequest): Promise<OperatorPermissionList> }
