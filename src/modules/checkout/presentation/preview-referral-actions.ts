"use server";

import { z } from "zod";
import { productId } from "@/modules/catalog/public";
import { ReferralRuleError } from "@/modules/referral/public";
import { application } from "@/shared/infrastructure/composition-root";
import { getPreviewReferralProgram, previewReferralMember, PREVIEW_REFERRAL_ORDER_LIMIT } from "@/shared/infrastructure/referral/preview-referral-runtime";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
import { GIFT_QUANTITY_MAX, GIFT_QUANTITY_MIN } from "../domain/purchase-intent-policy";
import { assertPreviewQuantity, previewTotals } from "../domain/preview-pricing";
import { InvalidPurchaseIntentInputError } from "../domain/purchase-intent-policy";

const inputSchema = z.object({
  requestId: z.uuid(), productId: z.string().min(1).max(100),
  quantity: z.number().int().min(GIFT_QUANTITY_MIN).max(GIFT_QUANTITY_MAX),
});

export type PreviewReferralQuote = Readonly<{
  requestId: string; productId: string; quantity: number;
  subtotalAmount: number; shippingAmount: number; totalAmount: number; discountAmount: number; couponId: string | null; tracked: boolean;
}>;

export async function quotePreviewReferralAction(input: unknown): Promise<{ quote?: PreviewReferralQuote; error?: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "カートの内容を確認してください。" };
  try {
    const program = getPreviewReferralProgram();
    const member = await previewReferralMember();
    const product = await application.getProduct.byId(productId(parsed.data.productId));
    if (!product?.available) return { error: "この商品は現在ご購入いただけません。" };
    assertPreviewQuantity(parsed.data.quantity, Boolean(product.previewOffer));
    const subtotalAmount = product.price.amount * parsed.data.quantity;
    const discount = member ? program.quote(member, subtotalAmount, new Date()) : { couponId: null, discountMinor: 0 };
    return { quote: { ...parsed.data, ...previewTotals(subtotalAmount, product.previewOffer?.shippingAmount, discount.discountMinor), couponId: discount.couponId, tracked: Boolean(member) } };
  } catch (error) {
    if (error instanceof InvalidPurchaseIntentInputError) return { error: error.message };
    reportUnexpectedError(error, { operation: "preview_referral_quote" });
    return { error: "特典を確認できませんでした。再試行するか、特典を使わずにお進みください。" };
  }
}

export async function settlePreviewReferralAction(input: unknown): Promise<{ quote?: PreviewReferralQuote; error?: string; unavailable?: true }> {
  const parsed = inputSchema.extend({
    couponId: z.string().min(1).max(160).nullable(),
    expectedSubtotal: z.number().int().nonnegative(),
    expectedShipping: z.number().int().nonnegative(),
  }).safeParse(input);
  if (!parsed.success) return { error: "注文内容をもう一度ご確認ください。" };
  try {
    const program = getPreviewReferralProgram();
    const member = await previewReferralMember();
    const product = await application.getProduct.byId(productId(parsed.data.productId));
    if (!product?.available) return { error: "この商品は現在ご購入いただけません。" };
    assertPreviewQuantity(parsed.data.quantity, Boolean(product.previewOffer));
    const subtotalAmount = product.price.amount * parsed.data.quantity;
    const totals = previewTotals(subtotalAmount, product.previewOffer?.shippingAmount);
    if (subtotalAmount !== parsed.data.expectedSubtotal || totals.shippingAmount !== parsed.data.expectedShipping) return { error: "商品価格または送料が変わりました。カートから内容をご確認ください。" };
    if (parsed.data.couponId && !member) return { error: "特典のテスト利用情報が失効しました。特典を再確認してください。" };
    if (program.orderCount >= PREVIEW_REFERRAL_ORDER_LIMIT && !program.hasOrder(parsed.data.requestId)) {
      return { error: "テストの保存上限に達しました。特典を使わずにお進みください。", unavailable: true };
    }
    const result = member ? program.recordPaidOrder({
      id: parsed.data.requestId, buyerId: member, subtotalMinor: subtotalAmount,
      fingerprint: `${parsed.data.productId}:${parsed.data.quantity}:${totals.shippingAmount}`, couponId: parsed.data.couponId,
    }, new Date()) : { discountMinor: 0, couponId: null };
    return { quote: {
      requestId: parsed.data.requestId, productId: parsed.data.productId, quantity: parsed.data.quantity,
      ...previewTotals(subtotalAmount, totals.shippingAmount, result.discountMinor), couponId: result.couponId, tracked: Boolean(member),
    } };
  } catch (error) {
    if (error instanceof InvalidPurchaseIntentInputError) return { error: error.message };
    if (error instanceof ReferralRuleError) return { error: "特典が使用済み・期限切れ、または注文内容が変わっています。特典を再確認してください。" };
    reportUnexpectedError(error, { operation: "preview_referral_settle" });
    return { error: "特典を確定できませんでした。再試行してください。", unavailable: true };
  }
}

export async function simulateReferralOrderAction(input: unknown): Promise<{ success?: true; error?: string }> {
  const parsed = z.object({ requestId: z.uuid(), operation: z.enum(["delivered", "refunded"]) }).safeParse(input);
  if (!parsed.success) return { error: "テスト注文を確認してください。" };
  try {
    const program = getPreviewReferralProgram();
    const member = await previewReferralMember();
    if (!member) return { error: "このテスト注文の利用者で操作してください。" };
    if (parsed.data.operation === "delivered") program.deliver(parsed.data.requestId, member, new Date());
    else program.reverse(parsed.data.requestId, member);
    return { success: true };
  } catch (error) {
    if (!(error instanceof ReferralRuleError)) reportUnexpectedError(error, { operation: "preview_referral_order_event" });
    return { error: "この利用者のテスト注文が見つかりません。" };
  }
}
