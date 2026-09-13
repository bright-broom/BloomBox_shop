import { describe, expect, it } from "vitest";
import { giftExperienceContent, giftExperienceSchema } from "./gift-experience-content";
import { GIFT_MESSAGE_MAX_LENGTH } from "@/modules/checkout/public";

describe("gift experience content", () => {
  it.each(["", "あ".repeat(GIFT_MESSAGE_MAX_LENGTH + 1)])("rejects an unusable default message", (defaultMessage) => {
    expect(giftExperienceSchema.safeParse({ ...giftExperienceContent, giftForm: { ...giftExperienceContent.giftForm, defaultMessage } }).success).toBe(false);
  });
  it("requires a short loading tip and explicit unavailability copy", () => {
    expect(giftExperienceSchema.safeParse({ ...giftExperienceContent, loading: { ...giftExperienceContent.loading, tips: [] } }).success).toBe(false);
    expect(giftExperienceContent.recipient.notice).toContain("発行・利用はできません");
    expect(giftExperienceContent.launch.notice).toContain("箱の寸法は確認中");
  });
});
