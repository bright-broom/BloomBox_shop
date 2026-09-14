"use server";

import { bindAdvertisingCheckout } from "@/shared/infrastructure/advertising-runtime";
import { LoyaltyUnavailableError } from "@/modules/customer/public";
import { InsufficientInventoryError, InventoryUnavailableError } from "@/modules/inventory/public";
import { DeliveryDateUnavailableError } from "@/modules/fulfillment/public";
import { productId } from "@/modules/catalog/public";
import { PREVIEW_SHIPPING_AMOUNT } from "../domain/preview-pricing";
import { formatMoney } from "@/shared/domain/money";
import { application } from "@/shared/infrastructure/composition-root";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
import { ProductUnavailableError } from "../application/create-purchase-intent";
import {
  PurchaseCancellationUnavailableError,
  PurchaseCancellationUnconfirmedError,
} from "../application/cancel-purchase-intent";
import { PurchaseIntentNotFoundError } from "../application/start-checkout";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { PurchaseCustomerMismatchError } from "../domain/purchase-customer";
import { CheckoutPausedError } from "../application/checkout-paused-error";
import { CheckoutPreparationUnavailableError } from "../application/checkout-session-provider";
import { InvalidPurchaseIntentInputError } from "../domain/purchase-intent-policy";
import { ShippingPriceUnavailableError } from "../domain/purchase-shipping";
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
      await bindAdvertisingCheckout(intent.id, prepared.checkoutSession.provider, prepared.checkoutSession.id);
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
        shippingAmount: intent.shippingAmount?.amount ?? PREVIEW_SHIPPING_AMOUNT,
        formattedTotal: formatMoney(intent.item.subtotal),
      },
    };
  } catch (error) {
    if (
      error instanceof LoyaltyUnavailableError
      || error instanceof InsufficientInventoryError
      || error instanceof ShippingPriceUnavailableError
      || error instanceof InventoryUnavailableError
      || error instanceof ProductUnavailableError
      || error instanceof PurchaseCustomerMismatchError
      || error instanceof CheckoutPausedError
      || error instanceof CheckoutPreparationUnavailableError
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

export type CancelPurchaseIntentResult =
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "not_prepared" }>
  | Readonly<{ status: "completed" }>
  | Readonly<{ error: string }>;

/**
 * Ownership, state, and provider confirmation are decided by the use case. The browser only
 * learns whether its local cart may be removed; it never releases inventory itself.
 */
export async function cancelPurchaseIntentAction(requestId: unknown): Promise<CancelPurchaseIntentResult> {
  const parsed = createPurchaseIntentSchema.shape.requestId.safeParse(requestId);
  if (!parsed.success) return { error: giftExperienceContent.cart.cancelFailed };

  try {
    const outcome = await application.cancelPurchaseIntent.execute(parsed.data);
    // A finished checkout is never cancelled here; the browser may only clear its stale cart.
    return outcome === "CHECKOUT_COMPLETED" ? { status: "completed" } : { status: "cancelled" };
  } catch (error) {
    // No server-side purchase was prepared from this cart, so nothing is reserved.
    if (error instanceof PurchaseIntentNotFoundError) return { status: "not_prepared" };
    if (error instanceof PurchaseCustomerMismatchError || error instanceof PurchaseCancellationUnavailableError) {
      return { error: error.message };
    }
    // Unconfirmed provider results stay observable: a persistent Stripe fault must not look like a retry loop.
    const errorId = reportUnexpectedError(error, { operation: "cancel_purchase_intent" });
    const message = error instanceof PurchaseCancellationUnconfirmedError ? error.message : giftExperienceContent.cart.cancelFailed;
    return { error: `${message}（エラー ID: ${errorId}）` };
  }
}
