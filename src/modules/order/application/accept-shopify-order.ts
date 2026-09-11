import type { DeliveryAddress, DeliveryCoveragePolicy } from "@/modules/fulfillment/public";
import type { OrderPricingFacts } from "../domain/order-pricing";

/** Trusted internal provider facts only. Never expose this command to browser-supplied order data. */
export type ShopifyOrderAcceptance = Readonly<{
  purchaseIntentId: string; attemptId: string; shop: string; orderId: string;
  paymentVersion: number; updatedAt: string; variantId: string;
  pricing: OrderPricingFacts;
  address: DeliveryAddress & Readonly<{ addressLine2: string | null; phone: string | null }>;
}>;
export type ShopifyOrderAcceptancePolicy = Readonly<{ approval: "PENDING" }> | Readonly<{
  approval: "APPROVED"; testMode: boolean; coverage: DeliveryCoveragePolicy; taxesIncluded: boolean;
  shippingByProduct: Readonly<Record<string, number>>; piiRetentionDays: number;
}>;
export const SHOPIFY_ORDER_ACCEPTANCE_POLICY: ShopifyOrderAcceptancePolicy = { approval: "PENDING" };
export type ShopifyOrderAcceptanceResult = Readonly<{ outcome: "CREATED" | "DUPLICATE"; orderId: string; displayId: string }> | Readonly<{
  outcome: "HELD"; reason: "TERMS_NOT_APPROVED" | "ADDRESS_UNRESOLVED" | "PRICING_UNRESOLVED" | "STALE_PAYMENT"
    | "PAYMENT_UNSETTLED" | "DELIVERY_UNAVAILABLE" | "PURCHASE_UNAVAILABLE" | "DISCOUNTS_UNSUPPORTED" | "TERMS_MISMATCH";
}>;
export interface ShopifyOrderAcceptor {
  accept(input: ShopifyOrderAcceptance): Promise<ShopifyOrderAcceptanceResult>;
}
export class ShopifyOrderAcceptanceConflictError extends Error {
  constructor() { super("Shopify order acceptance requires reconciliation"); this.name = "ShopifyOrderAcceptanceConflictError"; }
}
export class ShopifyOrderAcceptancePersistenceError extends Error {
  constructor() { super("Shopify order acceptance could not be persisted"); this.name = "ShopifyOrderAcceptancePersistenceError"; }
}
