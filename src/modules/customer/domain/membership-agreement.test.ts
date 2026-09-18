import { describe, expect, it } from "vitest";
import { InvalidMembershipAgreementVersionError, membershipAgreementState } from "./membership-agreement";

describe("membershipAgreementState", () => {
  it("requires a first agreement from a new account", () => {
    expect(membershipAgreementState(null, "2026-09-19")).toEqual({ status: "required", version: "2026-09-19", previousVersion: null });
  });

  it("accepts only the latest grant of the current version", () => {
    expect(membershipAgreementState({ status: "GRANTED", version: "2026-09-19" }, "2026-09-19")).toEqual({ status: "agreed", version: "2026-09-19" });
  });

  it("asks again after the terms change and reports the version the member agreed to", () => {
    expect(membershipAgreementState({ status: "GRANTED", version: "2026-09-19-draft" }, "2026-10-01"))
      .toEqual({ status: "required", version: "2026-10-01", previousVersion: "2026-09-19-draft" });
  });

  it("treats a withdrawal as no agreement", () => {
    expect(membershipAgreementState({ status: "WITHDRAWN", version: "2026-09-19" }, "2026-09-19"))
      .toEqual({ status: "required", version: "2026-09-19", previousVersion: null });
  });

  it.each(["", "2026 09 19", "A-1", "-1", "x".repeat(41)])("rejects the malformed version %j", (version) => {
    expect(() => membershipAgreementState(null, version)).toThrow(InvalidMembershipAgreementVersionError);
  });
});
