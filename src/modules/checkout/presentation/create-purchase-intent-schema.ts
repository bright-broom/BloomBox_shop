import { isAvailableDeliveryDate } from "@/modules/fulfillment/public";
import { z } from "zod";
import {
  GIFT_MESSAGE_MAX_LENGTH,
  GIFT_QUANTITY_MAX,
  GIFT_QUANTITY_MIN,
  RECIPIENT_NAME_MAX_LENGTH,
} from "../domain/purchase-intent-policy";

export const createPurchaseIntentSchema = z.object({
  requestId: z.string().uuid(),
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(GIFT_QUANTITY_MIN).max(GIFT_QUANTITY_MAX),
  recipientName: z
    .string()
    .trim()
    .min(1, "お届け先のお名前を入力してください。")
    .max(RECIPIENT_NAME_MAX_LENGTH, `${RECIPIENT_NAME_MAX_LENGTH}文字以内で入力してください。`),
  deliveryDate: z
    .iso.date("お届け日を選択してください。")
    .refine(isAvailableDeliveryDate, "お届け可能な日付を選択してください。"),
  giftMessage: z
    .string()
    .trim()
    .min(1, "メッセージを入力してください。")
    .max(GIFT_MESSAGE_MAX_LENGTH, `${GIFT_MESSAGE_MAX_LENGTH}文字以内で入力してください。`),
});

export type CreatePurchaseIntentFormState = Readonly<{
  error?: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
  draft?: Readonly<{
    requestId: string;
    displayId: string;
    productName: string;
    quantity: number;
    deliveryDate: string;
    subtotalAmount: number;
    shippingAmount: number;
    formattedTotal: string;
  }>;
  checkout?: Readonly<{
    url: string;
  }>;
}>;
