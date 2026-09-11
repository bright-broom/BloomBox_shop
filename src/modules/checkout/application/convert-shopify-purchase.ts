export type ShopifyPurchaseConversion = Readonly<{ shop: string; externalOrderId: string; orderId: string; purchaseIntentId: string; attemptId: string }>;
export interface ShopifyPurchaseConverter {
  convert(input: ShopifyPurchaseConversion): Promise<Readonly<{ outcome: "CONVERTED" | "DUPLICATE" }>>;
}
export class ShopifyPurchaseConversionError extends Error {
  constructor() { super("Shopify purchase conversion requires reconciliation"); this.name = "ShopifyPurchaseConversionError"; }
}
