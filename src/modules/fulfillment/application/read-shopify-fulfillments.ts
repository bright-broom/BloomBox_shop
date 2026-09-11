import type { ShopifyFulfillmentFact } from "../domain/shopify-fulfillment-observation";
import type { ShopifyFulfillmentQuantities } from "../domain/shopify-fulfillment-quantities";
export type ShopifyFulfillmentSnapshot = Readonly<{
  shop: string; orderId: string; test: boolean; quantities: ShopifyFulfillmentQuantities | null; fulfillments: readonly ShopifyFulfillmentFact[];
}>;
export interface ShopifyFulfillmentReader {
  readFulfillments(reference: Readonly<{ shop: string; orderId: string; test: boolean }>): Promise<ShopifyFulfillmentSnapshot>;
}
export class ShopifyFulfillmentUnavailableError extends Error {
  constructor() { super("Shopify fulfillment evidence is unavailable"); this.name = "ShopifyFulfillmentUnavailableError"; }
}
