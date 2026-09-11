import type { DeliveryDestinationAssessment } from "@/modules/fulfillment/public";

export type ShopifyDestinationReference = Readonly<{ shop: string; orderId: string; updatedAt: string; test: boolean }>;
export type ShopifyDestinationAssessment = DeliveryDestinationAssessment | Readonly<{
  status: "HELD"; reason: "ORDER_CHANGED" | "SHIPPING_NOT_REQUIRED" | "PREREQUISITES_UNRESOLVED";
}>;
export interface ShopifyDeliveryDestinationReader {
  assessDestination(reference: ShopifyDestinationReference): Promise<ShopifyDestinationAssessment>;
}
export class ShopifyDeliveryDestinationUnavailableError extends Error {
  constructor() { super("Shopify delivery destination could not be verified"); this.name = "ShopifyDeliveryDestinationUnavailableError"; }
}
