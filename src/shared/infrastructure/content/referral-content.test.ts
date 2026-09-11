import { describe, expect, it } from "vitest";
import { referralContent, referralContentSchema, referralCopy } from "./referral-content";

describe("referral content", () => {
  it("validates all editable copy and renders the centrally owned policy", () => {
    expect(referralContentSchema.safeParse(referralContent).success).toBe(true);
    expect(referralCopy(referralContent.terms)).toContain("5,500");
    expect(referralCopy(referralContent.terms)).toContain("90");
    expect(referralCopy(referralContent.friendBenefit)).toContain("500");
    expect(referralCopy(referralContent.terms)).not.toContain("{");
  });
});
