"use server";

import { InsufficientInventoryError, InventoryUnavailableError } from "@/modules/inventory/public";
import { DeliveryDateUnavailableError } from "@/modules/fulfillment/public";
import { productId } from "@/modules/catalog/public";
import { PREVIEW_SHIPPING_AMOUNT } from "../domain/preview-pricing";
import { formatMoney } from "@/shared/domain/money";
import { application } from "@/shared/infrastructure/composition-root";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
import { ProductUnavailableError } from "../application/create-purchase-intent";
import { PurchaseCustomerMismatchError } from "../domain/purchase-customer";
import { CheckoutPausedError } from "../application/checkout-paused-error";
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
    requestId: formData.get("requestId"),
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
    recipientName: formData.get("recipientName"),
    deliveryDate: formData.get("deliveryDate"),
    giftMessage: formData.get("giftMessage"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const prepared = await application.preparePurchase.execute(parsed.data);
    const intent = prepared.intent;
    if (prepared.checkoutSession) {
      return { checkout: { url: prepared.checkoutSession.url } };
    }
    const product = await application.getProduct.byId(productId(parsed.data.productId));
    if (!product?.available) throw new ProductUnavailableError();
    return {
      draft: {
        requestId: parsed.data.requestId,
        displayId: intent.displayId,
        productName: intent.item.productName,
        quantity: intent.item.quantity,
        deliveryDate: intent.recipient.deliveryDate,
        subtotalAmount: intent.item.subtotal.amount,
        shippingAmount: product.previewOffer?.shippingAmount ?? PREVIEW_SHIPPING_AMOUNT,
        formattedTotal: formatMoney(intent.item.subtotal),
      },
    };
  } catch (error) {
    if (
      error instanceof InsufficientInventoryError
      || error instanceof InventoryUnavailableError
      || error instanceof ProductUnavailableError
      || error instanceof PurchaseCustomerMismatchError
      || error instanceof CheckoutPausedError
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
