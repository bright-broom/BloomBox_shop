import type { ShopifyPurchaseConversion } from "@/modules/checkout/public";
export type ShopifyOrderPaymentResult = Readonly<{ outcome: "APPLIED" | "DUPLICATE"; paymentId: string; version: number;
  status: "CAPTURED" | "PARTIALLY_REFUNDED" | "REFUNDED" }>;
export interface ShopifyOrderPaymentProjector {
  project(input: ShopifyPurchaseConversion): Promise<ShopifyOrderPaymentResult>;
}
export class ShopifyOrderPaymentProjectionError extends Error {
  constructor() { super("Shopify order payment projection requires reconciliation"); this.name = "ShopifyOrderPaymentProjectionError"; }
}
