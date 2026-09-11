import type { PermissionRevocationReason } from "../domain/permission-revocation";

export type PermissionRevocationRequest = Readonly<{
  shop: string; permissionId: string; reviewedVersion: number;
  reason: PermissionRevocationReason; idempotencyKey: string;
}>;
export type PermissionRevocationReceipt = Readonly<{
  outcome: "REVOKED" | "DUPLICATE"; revocationId: string; permissionId: string;
  previousVersion: number; version: number; revokedAt: Date;
}>;
export interface OperatorPermissionRevoker {
  revoke(input: PermissionRevocationRequest): Promise<PermissionRevocationReceipt>;
}
export class PermissionRevocationError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "NOT_AUTHORIZED" | "REVIEW_REQUIRED" | "CONFLICT" | "UNAVAILABLE") {
    super(`Operator permission revocation: ${code}`); this.name = "PermissionRevocationError";
  }
}
