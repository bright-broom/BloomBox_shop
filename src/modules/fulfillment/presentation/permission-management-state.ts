import type { OperatorPermissionList } from "../application/read-operator-permissions";
export type PermissionManagementState = Readonly<{
  status: "IDLE" | "REVOKED" | "DUPLICATE" | "INVALID_REQUEST" | "NOT_AUTHORIZED" | "REVIEW_REQUIRED" | "CONFLICT" | "UNAVAILABLE" | "RATE_LIMITED";
}>;
export type PermissionManagementPage = Omit<OperatorPermissionList, "entries"> & Readonly<{
  entries: ReadonlyArray<OperatorPermissionList["entries"][number] & Readonly<{ intent: string | null }>>;
}>;
