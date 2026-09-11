import { describe, expect, it } from "vitest";
import { giftExperienceContent, giftExperienceSchema } from "./gift-experience-content";

describe("gift experience content", () => {
  it("requires a short loading tip and explicit unavailability copy", () => {
    expect(giftExperienceSchema.safeParse({ ...giftExperienceContent, loading: { ...giftExperienceContent.loading, tips: [] } }).success).toBe(false);
    expect(giftExperienceContent.recipient.notice).toContain("発行・利用はできません");
    expect(giftExperienceContent.launch.notice).toContain("箱の寸法は確認中");
  });
});
