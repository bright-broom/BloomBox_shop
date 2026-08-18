"use server";

import { ProductUnavailableError } from "@/modules/order/application/create-order";
import { application } from "@/shared/infrastructure/composition-root";
import { redirect } from "next/navigation";
import { createOrderSchema, type CreateOrderFormState } from "./create-order-schema";

export async function createOrderAction(
  _previousState: CreateOrderFormState,
  formData: FormData,
): Promise<CreateOrderFormState> {
  const parsed = createOrderSchema.safeParse({
    productId: formData.get("productId"),
    recipientName: formData.get("recipientName"),
    deliveryDate: formData.get("deliveryDate"),
    giftMessage: formData.get("giftMessage"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  let orderId: string;
  try {
    const order = await application.createOrder.execute(parsed.data);
    orderId = order.id;
  } catch (error) {
    if (error instanceof ProductUnavailableError) {
      return { error: error.message };
    }
    return { error: "ご注文を開始できませんでした。時間をおいてもう一度お試しください。" };
  }

  redirect(`/order/${orderId}`);
}
