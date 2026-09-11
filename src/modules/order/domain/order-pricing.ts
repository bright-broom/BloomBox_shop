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
  lines: readonly Readonly<{ quantity: number; currentQuantity: number; unitPrice: number; discounts: readonly number[]; taxes: readonly number[] }>[];
  shipping: readonly Readonly<{ originalPrice: number; discountedPrice: number; currentDiscountedPrice: number; removed: boolean; taxes: readonly number[] }>[];
}>;
export type OrderPricingHoldReason = "MISSING_PRICING" | "INVALID_AMOUNTS" | "ESTIMATED_TAXES"
  | "ORDER_CHANGED" | "UNSUPPORTED_CHARGES" | "UNSUPPORTED_SHIPPING" | "AMOUNT_MISMATCH" | "STALE_OBSERVATION" | "TAX_ALLOCATION_MISMATCH";
export type OrderPriceComponent = Readonly<{
  price: number; discount: number; additionalTax: number; includedTax: number; total: number;
}>;
/** Values retain the purchase-time tax basis; additional tax alone participates in the additive total. */
export type OrderPriceSnapshot = Readonly<{
  currency: "JPY"; taxesIncluded: boolean; subtotal: number; shipping: number; discount: number; additionalTax: number; includedTax: number; total: number;
  items: readonly Readonly<OrderPriceComponent & { unitPrice: number; quantity: number }>[];
  delivery: OrderPriceComponent;
}>;
export type OrderPricingAssessment = Readonly<{ status: "HELD"; reason: OrderPricingHoldReason }> | Readonly<{
  status: "MATCHED";
  /** MATCHED proves arithmetic only, never authorization, payment, delivery or order acceptance. */
  snapshot: OrderPriceSnapshot;
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
    ...facts.lines.flatMap((line) => [line.unitPrice, line.quantity, line.currentQuantity, ...line.discounts, ...line.taxes]),
    ...facts.shipping.flatMap((line) => [line.originalPrice, line.discountedPrice, line.currentDiscountedPrice, ...line.taxes])];
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
  const items: Array<OrderPriceComponent & { unitPrice: number; quantity: number }> = [];
  const components = [
    ...facts.lines.map((line) => ({ price: line.unitPrice * line.quantity, discount: line.discounts.reduce((sum, value) => sum + value, 0), taxes: line.taxes })),
    { price: shipping.originalPrice, discount: shipping.originalPrice - shipping.discountedPrice, taxes: shipping.taxes },
  ];
  const priced: OrderPriceComponent[] = [];
  let allocatedTax = 0;
  for (const component of components) {
    const tax = component.taxes.reduce((sum, value) => sum + value, 0);
    if (!validAmount(tax) || !validAmount(allocatedTax + tax)) return hold("INVALID_AMOUNTS");
    allocatedTax += tax;
    const additionalTax = facts.taxesIncluded ? 0 : tax;
    const includedTax = facts.taxesIncluded ? tax : 0;
    const componentTotal = component.price - component.discount + additionalTax;
    if (!validAmount(component.price + additionalTax) || !validAmount(componentTotal)) return hold("INVALID_AMOUNTS");
    if (includedTax > componentTotal) return hold("TAX_ALLOCATION_MISMATCH");
    priced.push({ price: component.price, discount: component.discount, additionalTax, includedTax, total: componentTotal });
  }
  if (allocatedTax !== facts.tax) return hold("TAX_ALLOCATION_MISMATCH");
  facts.lines.forEach((line, index) => items.push({ ...priced[index], unitPrice: line.unitPrice, quantity: line.quantity }));
  const delivery = priced[priced.length - 1];
  const additionalTax = facts.taxesIncluded ? 0 : allocatedTax;
  const discount = merchandiseDiscount + delivery.discount;
  if (![merchandise + delivery.price + additionalTax, discount].every(validAmount)) return hold("INVALID_AMOUNTS");
  if (priced.reduce((sum, component) => sum + component.total, 0) !== total) return hold("AMOUNT_MISMATCH");
  const snapshot: OrderPriceSnapshot = { currency: "JPY", taxesIncluded: facts.taxesIncluded, subtotal: merchandise, shipping: delivery.price,
    discount, additionalTax, includedTax: facts.taxesIncluded ? allocatedTax : 0, total, items, delivery };
  return { status: "MATCHED", snapshot, totals: { currency: "JPY", taxesIncluded: facts.taxesIncluded,
    merchandise, merchandiseDiscount, shipping: shipping.originalPrice,
    shippingDiscount: shipping.originalPrice - shipping.discountedPrice, tax: facts.tax, total } };
}
