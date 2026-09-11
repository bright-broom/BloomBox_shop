import type { ShopifyFulfillmentFact } from "../domain/shopify-fulfillment-observation";
export type ShopifyFulfillmentSnapshot = Readonly<{
  shop: string; orderId: string; test: boolean; fulfillments: readonly ShopifyFulfillmentFact[];
}>;
export interface ShopifyFulfillmentReader {
  readFulfillments(reference: Readonly<{ shop: string; orderId: string; test: boolean }>): Promise<ShopifyFulfillmentSnapshot>;
}
export class ShopifyFulfillmentUnavailableError extends Error {
  constructor() { super("Shopify fulfillment evidence is unavailable"); this.name = "ShopifyFulfillmentUnavailableError"; }
}
