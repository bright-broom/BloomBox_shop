import { z } from "zod";
import { isAvailableDeliveryDate } from "@/modules/fulfillment/domain/delivery-date";

const MAX_GIFT_MESSAGE_LENGTH = 180;

export const createOrderSchema = z.object({
  productId: z.string().trim().min(1),
  recipientName: z.string().trim().min(1, "お届け先のお名前を入力してください。 ").max(80),
  deliveryDate: z
    .iso.date("お届け日を選択してください。")
    .refine(isAvailableDeliveryDate, "お届け可能な日付を選択してください。"),
  giftMessage: z
    .string()
    .trim()
    .min(1, "メッセージを入力してください。")
    .max(MAX_GIFT_MESSAGE_LENGTH, `${MAX_GIFT_MESSAGE_LENGTH}文字以内で入力してください。`),
});

export type CreateOrderFormState = Readonly<{
  error?: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}>;
