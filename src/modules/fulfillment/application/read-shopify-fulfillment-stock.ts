import type { ShopifyFulfillmentStockSnapshot } from "../domain/shopify-fulfillment-stock";
export interface ShopifyFulfillmentStockReader {
  readFulfillmentStock(reference: Readonly<{ shop: string; orderId: string; test: boolean }>): Promise<ShopifyFulfillmentStockSnapshot>;
}
export class ShopifyFulfillmentStockUnavailableError extends Error {
  constructor() { super("Shopify fulfillment stock is unavailable"); this.name = "ShopifyFulfillmentStockUnavailableError"; }
}
