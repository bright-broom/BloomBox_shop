export type AcceptedShopifyOrder = Readonly<{ orderId: string; displayId: string; purchaseIntentId: string; attemptId: string }>;
export interface ShopifyAcceptedOrderQuery {
  find(shop: string, externalOrderId: string): Promise<AcceptedShopifyOrder | null>;
}
export class ShopifyAcceptedOrderUnavailableError extends Error {
  constructor() { super("Accepted Shopify order could not be resolved"); this.name = "ShopifyAcceptedOrderUnavailableError"; }
}
