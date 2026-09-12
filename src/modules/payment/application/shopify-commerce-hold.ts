import type { ReconcileShopifyPayment } from "./reconcile-shopify-payment";

type Reconciliation = Awaited<ReturnType<ReconcileShopifyPayment["execute"]>>;
export type ShopifyCommerceHold = "CONFIGURATION" | "TERMS" | "PAYMENT" | "PRICING" | "DELIVERY" | "ORDER" | "INCOMPLETE";
const errorNames: Readonly<Record<ShopifyCommerceHold, string>> = {
  CONFIGURATION: "ShopifyCommerceConfigurationHoldError",
  TERMS: "ShopifyCommerceTermsHoldError",
  PAYMENT: "ShopifyCommercePaymentHoldError",
  PRICING: "ShopifyCommercePricingHoldError",
  DELIVERY: "ShopifyCommerceDeliveryHoldError",
  ORDER: "ShopifyCommerceOrderHoldError",
  INCOMPLETE: "ShopifyCommerceIncompleteError",
};

/** Only fixed categories reach the existing queue error column; never copy provider values or PII. */
export class ShopifyCommerceIncompleteError extends Error {
  constructor(readonly category: ShopifyCommerceHold = "INCOMPLETE") {
    super("Shopify commerce reconciliation is incomplete"); this.name = errorNames[category];
  }
}

/** Classify an already-held result for operators; this never changes completion or retry decisions. */
export function classifyShopifyCommerceHold(result: Reconciliation): ShopifyCommerceHold {
  const acceptance = result.acceptance;
  if (acceptance.outcome !== "HELD") return "CONFIGURATION";
  switch (acceptance.reason) {
    case "NOT_CONFIGURED": return "CONFIGURATION";
    case "TERMS_NOT_APPROVED": case "TERMS_MISMATCH": return "TERMS";
    case "PRICING_UNRESOLVED": case "DISCOUNTS_UNSUPPORTED": return "PRICING";
    case "PAYMENT_UNSETTLED": return "PAYMENT";
    case "ADDRESS_UNRESOLVED": case "DELIVERY_UNAVAILABLE": return "DELIVERY";
    case "ORDER_CHANGED": case "SHIPPING_NOT_REQUIRED": case "STALE_PAYMENT": case "PURCHASE_UNAVAILABLE": return "ORDER";
  }
  // These prerequisite assessments describe the first blocked stage. Do not report downstream
  // PREREQUISITES_UNRESOLVED as an address failure when payment or pricing has not passed yet.
  if (result.outcome === "STALE") return "ORDER";
  const timing = result.deliveryTiming;
  if (timing.status === "HELD" && timing.reason === "ORDER_CANCELLED") return "ORDER";
  if (result.status !== "CAPTURED") return "PAYMENT";
  if (timing.status === "HELD" && (timing.reason === "PAYMENT_PENDING" || timing.reason === "PAYMENT_NOT_SETTLED")) return "PAYMENT";
  if (result.pricing.status === "HELD") return "PRICING";
  if (timing.status === "HELD") {
    if (timing.reason === "STALE_OBSERVATION" || timing.reason === "PURCHASE_ALREADY_CONVERTED"
      || timing.reason === "PURCHASE_INACTIVE" || timing.reason === "PURCHASE_DETAILS_UNAVAILABLE"
      || timing.reason === "ORDER_ALREADY_ACCEPTED") return "ORDER";
    return "DELIVERY";
  }
  if (result.destination.status === "HELD") return "DELIVERY";
  return "INCOMPLETE";
}
