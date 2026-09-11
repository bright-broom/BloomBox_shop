import type { ShopifyOrderLink } from "./link-shopify-order";

/** Internal read capability scoped to the existing immutable association. Contains no contact or gift text. */
export type ShopifyDeliveryPlan = Readonly<{
  deliveryDate: string;
  status: "CHECKOUT_CREATED" | "CONVERTED" | "EXPIRED" | "ABANDONED";
  detailsAvailable: boolean;
  retentionExpiresAt: Date;
}>;
export interface ShopifyDeliveryPlanQuery {
  find(link: ShopifyOrderLink, shop: string): Promise<ShopifyDeliveryPlan | null>;
}
export class ShopifyDeliveryPlanUnavailableError extends Error {
  constructor() { super("Shopify delivery plan could not be read"); this.name = "ShopifyDeliveryPlanUnavailableError"; }
}
