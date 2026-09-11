/** Fixed reasons avoid free-text personal data in security audit records. */
export const PERMISSION_REVOCATION_REASONS = ["ACCESS_NO_LONGER_REQUIRED", "ROLE_CHANGE", "SECURITY_RESPONSE"] as const;
export type PermissionRevocationReason = typeof PERMISSION_REVOCATION_REASONS[number];
