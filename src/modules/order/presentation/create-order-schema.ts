import { z } from "zod";
import { isAvailableDeliveryDate } from "@/modules/fulfillment/public";
import { GIFT_MESSAGE_MAX_LENGTH, RECIPIENT_NAME_MAX_LENGTH } from "../domain/order-policy";

export const createOrderSchema = z.object({
  productId: z.string().trim().min(1),
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

export type CreateOrderFormState = Readonly<{
  error?: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
  draft?: Readonly<{
    displayId: string;
    productName: string;
    deliveryDate: string;
    formattedTotal: string;
  }>;
}>;
