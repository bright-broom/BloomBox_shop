"use server";

import { DeliveryDateUnavailableError } from "@/modules/fulfillment/public";
import { formatMoney } from "@/shared/domain/money";
import { application } from "@/shared/infrastructure/composition-root";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
import { ProductUnavailableError } from "../application/create-purchase-intent";
import { InvalidPurchaseIntentInputError } from "../domain/purchase-intent-policy";
import {
  createPurchaseIntentSchema,
  type CreatePurchaseIntentFormState,
} from "./create-purchase-intent-schema";

export async function createPurchaseIntentAction(
  _previousState: CreatePurchaseIntentFormState,
  formData: FormData,
): Promise<CreatePurchaseIntentFormState> {
  const parsed = createPurchaseIntentSchema.safeParse({
    productId: formData.get("productId"),
    recipientName: formData.get("recipientName"),
    deliveryDate: formData.get("deliveryDate"),
    giftMessage: formData.get("giftMessage"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const intent = await application.createPurchaseIntent.execute(parsed.data);
    return {
      draft: {
        displayId: intent.displayId,
        productName: intent.item.productName,
        deliveryDate: intent.recipient.deliveryDate,
        formattedTotal: formatMoney(intent.item.subtotal),
      },
    };
  } catch (error) {
    if (
      error instanceof ProductUnavailableError
      || error instanceof DeliveryDateUnavailableError
      || error instanceof InvalidPurchaseIntentInputError
    ) {
      return { error: error.message };
    }
    const errorId = reportUnexpectedError(error, { operation: "create_purchase_intent" });
    return {
      error: `ご注文を開始できませんでした。時間をおいてもう一度お試しください。（エラー ID: ${errorId}）`,
    };
  }
}
