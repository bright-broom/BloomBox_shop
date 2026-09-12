/** Count retries too: the allowance limits work, not unique approvals. */
export const APPROVAL_SUBMISSION_POLICY = Object.freeze({ maxAttempts: 10, windowMs: 60_000 });

export function assessApprovalSubmission(attempts: readonly number[], nowMs: number):
  Readonly<{ allowed: false }> | Readonly<{ allowed: true; attempts: readonly number[] }> {
  // Future entries stay counted if the database clock moves backwards.
  const recent = attempts.filter((at) => at > nowMs - APPROVAL_SUBMISSION_POLICY.windowMs);
  if (recent.length >= APPROVAL_SUBMISSION_POLICY.maxAttempts) return { allowed: false };
  return { allowed: true, attempts: [...recent, nowMs] };
}
