import { describe, expect, it } from "vitest";
import { assessApprovalSubmission, APPROVAL_SUBMISSION_POLICY } from "./approval-submission-policy";

describe("approval submission allowance", () => {
  it("allows ten attempts in a rolling minute, including identical retries", () => {
    let attempts: readonly number[] = [];
    for (let i = 0; i < APPROVAL_SUBMISSION_POLICY.maxAttempts; i++) {
      const result = assessApprovalSubmission(attempts, 100_000);
      if (!result.allowed) throw new Error("Unexpected limit");
      attempts = result.attempts;
    }
    expect(assessApprovalSubmission(attempts, 159_999)).toEqual({ allowed: false });
    expect(assessApprovalSubmission(attempts, 160_000)).toEqual({ allowed: true, attempts: [160_000] });
  });
  it("releases only aged entries, without a fixed-minute boundary burst", () => {
    const attempts = [59_999, ...Array<number>(9).fill(60_001)];
    expect(assessApprovalSubmission(attempts, 60_002)).toEqual({ allowed: false });
    expect(assessApprovalSubmission(attempts, 119_999)).toEqual({ allowed: true, attempts: [...attempts.slice(1), 119_999] });
    expect(attempts).toHaveLength(10);
  });
  it("does not refund attempts when the clock moves backwards", () => {
    expect(assessApprovalSubmission(Array<number>(10).fill(200_000), 100_000)).toEqual({ allowed: false });
  });
});
