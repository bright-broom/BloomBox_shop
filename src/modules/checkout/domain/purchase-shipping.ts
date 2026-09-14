import { money, type Money } from "@/shared/domain/money";
import { InvalidPurchaseIntentInputError } from "./purchase-intent-policy";

export const SHIPPING_QUOTE_MAX_QUANTITY = 1;

/** Per-order JPY quote for one box; parcel pricing for multiple boxes is not approved. */
export function quotePurchaseShipping(amount: number, quantity: number): Money {
  if (quantity !== SHIPPING_QUOTE_MAX_QUANTITY) {
    throw new InvalidPurchaseIntentInputError("送料を確定できるご注文は1箱までです。複数箱は分けてご注文ください。");
  }
  return money(amount);
}

export class ShippingPriceUnavailableError extends Error {
  constructor() { super("送料を確認できないため、ご注文を開始できません。"); this.name = "ShippingPriceUnavailableError"; }
}
