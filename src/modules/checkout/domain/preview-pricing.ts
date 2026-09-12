import { InvalidPurchaseIntentInputError } from "./purchase-intent-policy";

export const PREVIEW_SHIPPING_AMOUNT = 1_100; // Legacy preview receipts only.
export const LAUNCH_PREVIEW_QUANTITY = 1;

/** No regional/tax/parcel assumptions: launch preview supports one box only. */
export function previewTotals(subtotalAmount: number, shippingAmount = PREVIEW_SHIPPING_AMOUNT, discountAmount = 0) {
  if (![subtotalAmount, shippingAmount, discountAmount].every((value) => Number.isSafeInteger(value) && value >= 0)
    || discountAmount > subtotalAmount || !Number.isSafeInteger(subtotalAmount + shippingAmount)) {
    throw new InvalidPurchaseIntentInputError("商品・送料・特典の金額を確認してください。");
  }
  return { subtotalAmount, shippingAmount, discountAmount, totalAmount: subtotalAmount + shippingAmount - discountAmount };
}

export function assertPreviewQuantity(quantity: number, isLaunchProduct: boolean) {
  if (isLaunchProduct && quantity !== LAUNCH_PREVIEW_QUANTITY) {
    throw new InvalidPurchaseIntentInputError("現在のBLOOM BOXのテスト購入は1箱ずつです。複数箱の送料は確認中です。");
  }
}
