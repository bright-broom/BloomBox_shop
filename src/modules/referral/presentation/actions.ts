"use server";

import { z } from "zod";
import {
  enrollPreviewReferralMember, getPreviewReferralProgram, previewReferralMember, switchPreviewReferralMember,
} from "@/shared/infrastructure/referral/preview-referral-runtime";
import { ReferralRuleError } from "../domain/referral-policy";
import type { ReferralSnapshot } from "../application/referral-program";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";

export async function readReferralAction(): Promise<{ snapshot: ReferralSnapshot | null; error?: string }> {
  try {
    const member = await previewReferralMember();
    return { snapshot: member ? getPreviewReferralProgram().snapshot(member, new Date()) : null };
  } catch (error) {
    reportUnexpectedError(error, { operation: "preview_referral_read" });
    return { snapshot: null, error: "紹介特典のテストを読み込めませんでした。" };
  }
}

export async function updateReferralAction(input: unknown): Promise<{ snapshot?: ReferralSnapshot; error?: string }> {
  const parsed = z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("enroll") }),
    z.object({ operation: z.literal("join"), code: z.string().trim().toUpperCase().regex(/^BB-[A-F0-9]{24}$/) }),
    z.object({ operation: z.literal("new_test_member") }),
    z.object({ operation: z.literal("switch_test_member") }),
  ]).safeParse(input);
  if (!parsed.success) return { error: "紹介コードを確認してください。" };
  try {
    const program = getPreviewReferralProgram();
    if (parsed.data.operation === "switch_test_member") await switchPreviewReferralMember();
    const member = await enrollPreviewReferralMember(parsed.data.operation === "new_test_member");
    if (parsed.data.operation === "join") program.join(member, parsed.data.code, new Date());
    return { snapshot: program.snapshot(member, new Date()) };
  } catch (error) {
    if (error instanceof ReferralRuleError) {
      const messages: Partial<Record<ReferralRuleError["code"], string>> = {
        SELF_REFERRAL: "ご自身の紹介コードは使えません。友人にリンクを送ってください。",
        UNKNOWN_INVITE: "紹介コードが見つかりません。テスト用データは再起動時にリセットされます。",
        ALREADY_JOINED: "すでに別の紹介特典を受け取っています。",
        FIRST_ORDER_ONLY: "友人向け特典は初回購入前にお受け取りください。",
      };
      return { error: messages[error.code] ?? "紹介特典を更新できませんでした。" };
    }
    reportUnexpectedError(error, { operation: "preview_referral_update" });
    return { error: "紹介特典のテストを利用できません。時間をおいて再度お試しください。" };
  }
}
