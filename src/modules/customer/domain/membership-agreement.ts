/**
 * Membership agreement: a member accepts the published terms and privacy policy of one version.
 * The agreement is recorded per account in the consent ledger; a new version requires agreeing again.
 */
export const MEMBERSHIP_AGREEMENT_PURPOSE = "MEMBERSHIP_TERMS";
export const MEMBERSHIP_AGREEMENT_VERSION = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type MembershipAgreementRecord = Readonly<{ status: "GRANTED" | "WITHDRAWN"; version: string }>;
export type MembershipAgreementState =
  | Readonly<{ status: "agreed"; version: string }>
  | Readonly<{ status: "required"; version: string; previousVersion: string | null }>;

export class InvalidMembershipAgreementVersionError extends Error {
  constructor() {
    super("Membership agreement version is invalid");
    this.name = "InvalidMembershipAgreementVersionError";
  }
}

export function membershipAgreementVersion(value: string): string {
  if (!MEMBERSHIP_AGREEMENT_VERSION.test(value)) throw new InvalidMembershipAgreementVersionError();
  return value;
}

/** Only the latest record counts: a withdrawal or an older version means the member must agree to the current one. */
export function membershipAgreementState(latest: MembershipAgreementRecord | null, currentVersion: string): MembershipAgreementState {
  const version = membershipAgreementVersion(currentVersion);
  if (latest?.status === "GRANTED" && latest.version === version) return { status: "agreed", version };
  return { status: "required", version, previousVersion: latest?.status === "GRANTED" ? latest.version : null };
}
