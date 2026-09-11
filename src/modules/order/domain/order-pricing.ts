/** Authoritative, JPY-only facts. Prices retain the provider's inclusive/exclusive tax basis. */
export type OrderPricingFacts = Readonly<{
  taxesIncluded: boolean;
  estimatedTaxes: boolean;
  edited: boolean;
  subtotal: number;
  currentSubtotal: number;
  tax: number;
  currentTax: number;
  total: number;
  originalTotal: number;
  currentTotal: number;
  currentShipping: number;
  duties: number;
  currentDuties: number;
  additionalFees: number;
  currentAdditionalFees: number;
  tips: number;
  lines: readonly Readonly<{ quantity: number; currentQuantity: number; unitPrice: number; discounts: readonly number[] }>[];
  shipping: readonly Readonly<{ originalPrice: number; discountedPrice: number; currentDiscountedPrice: number; removed: boolean }>[];
}>;
export type OrderPricingHoldReason = "MISSING_PRICING" | "INVALID_AMOUNTS" | "ESTIMATED_TAXES"
  | "ORDER_CHANGED" | "UNSUPPORTED_CHARGES" | "UNSUPPORTED_SHIPPING" | "AMOUNT_MISMATCH" | "STALE_OBSERVATION";
export type OrderPricingAssessment = Readonly<{ status: "HELD"; reason: OrderPricingHoldReason }> | Readonly<{
  status: "MATCHED";
  /** MATCHED proves arithmetic only, never authorization, payment, delivery or order acceptance. */
  totals: Readonly<{ currency: "JPY"; taxesIncluded: boolean; merchandise: number; merchandiseDiscount: number;
    shipping: number; shippingDiscount: number; tax: number; total: number }>;
}>;
const validAmount = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function assessOrderPricing(facts: OrderPricingFacts | null): OrderPricingAssessment {
  const hold = (reason: OrderPricingHoldReason): OrderPricingAssessment => ({ status: "HELD", reason });
  if (!facts) return hold("MISSING_PRICING");
  const amounts = [facts.subtotal, facts.currentSubtotal, facts.tax, facts.currentTax, facts.total, facts.originalTotal,
    facts.currentTotal, facts.currentShipping, facts.duties, facts.currentDuties, facts.additionalFees,
    facts.currentAdditionalFees, facts.tips,
    ...facts.lines.flatMap((line) => [line.unitPrice, line.quantity, line.currentQuantity, ...line.discounts]),
    ...facts.shipping.flatMap((line) => [line.originalPrice, line.discountedPrice, line.currentDiscountedPrice])];
  if (!amounts.every(validAmount) || facts.total === 0 || facts.lines.length === 0
    || facts.lines.some((line) => line.quantity === 0)) return hold("INVALID_AMOUNTS");
  if (facts.estimatedTaxes) return hold("ESTIMATED_TAXES");
  if (facts.edited || facts.originalTotal !== facts.total || facts.total !== facts.currentTotal
    || facts.subtotal !== facts.currentSubtotal || facts.tax !== facts.currentTax
    || facts.lines.some((line) => line.quantity !== line.currentQuantity)
    || facts.shipping.some((line) => line.removed || line.discountedPrice !== line.currentDiscountedPrice)) return hold("ORDER_CHANGED");
  if ([facts.duties, facts.currentDuties, facts.additionalFees, facts.currentAdditionalFees, facts.tips].some((value) => value !== 0)) {
    return hold("UNSUPPORTED_CHARGES");
  }
  if (facts.shipping.length !== 1) return hold("UNSUPPORTED_SHIPPING");
  let merchandise = 0; let merchandiseDiscount = 0;
  for (const line of facts.lines) {
    const gross = line.unitPrice * line.quantity;
    const discount = line.discounts.reduce((sum, amount) => sum + amount, 0);
    if (![gross, discount, merchandise + gross, merchandiseDiscount + discount].every(validAmount)) return hold("INVALID_AMOUNTS");
    if (discount > gross) return hold("AMOUNT_MISMATCH");
    merchandise += gross; merchandiseDiscount += discount;
  }
  const shipping = facts.shipping[0];
  if (shipping.discountedPrice > shipping.originalPrice || shipping.discountedPrice !== facts.currentShipping
    || merchandise - merchandiseDiscount !== facts.subtotal) return hold("AMOUNT_MISMATCH");
  const net = facts.subtotal + shipping.discountedPrice;
  const total = net + (facts.taxesIncluded ? 0 : facts.tax);
  if (![net, total].every(validAmount)) return hold("INVALID_AMOUNTS");
  if (total !== facts.total || (facts.taxesIncluded && facts.tax > total)) return hold("AMOUNT_MISMATCH");
  return { status: "MATCHED", totals: { currency: "JPY", taxesIncluded: facts.taxesIncluded,
    merchandise, merchandiseDiscount, shipping: shipping.originalPrice,
    shippingDiscount: shipping.originalPrice - shipping.discountedPrice, tax: facts.tax, total } };
}
