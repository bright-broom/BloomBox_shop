"use server";

import { ProductUnavailableError } from "@/modules/order/application/create-order";
import { DeliveryDateUnavailableError } from "@/modules/fulfillment/public";
import { application } from "@/shared/infrastructure/composition-root";
import { formatMoney } from "@/shared/domain/money";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
import { InvalidOrderInputError } from "../domain/order-policy";
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

  try {
    const order = await application.createOrder.execute(parsed.data);
    return {
      draft: {
        displayId: order.displayId,
        productName: order.item.productName,
        deliveryDate: order.recipient.deliveryDate,
        formattedTotal: formatMoney(order.item.subtotal),
      },
    };
  } catch (error) {
    if (
      error instanceof ProductUnavailableError
      || error instanceof DeliveryDateUnavailableError
      || error instanceof InvalidOrderInputError
    ) {
      return { error: error.message };
    }
    const errorId = reportUnexpectedError(error, { operation: "create_order" });
    return {
      error: `ご注文を開始できませんでした。時間をおいてもう一度お試しください。（エラー ID: ${errorId}）`,
    };
  }
}
