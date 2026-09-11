import type { FulfillmentStatus } from "../domain/fulfillment-status";
import type { FulfillmentIntakeDecision } from "../domain/shopify-fulfillment-intake";
import type { ShopifyFulfillmentActivity } from "../domain/shopify-fulfillment-observation";
export type ShopifyFulfillmentReference = Readonly<{ shop: string; externalOrderId: string; orderId: string; purchaseIntentId: string; attemptId: string }>;
export type ShopifyFulfillmentIntakeResult = Readonly<{
  outcome: "APPLIED" | "DUPLICATE"; fulfillmentId: string; status: FulfillmentStatus; decision: FulfillmentIntakeDecision;
  providerActivity: ShopifyFulfillmentActivity;
}>;
export interface ShopifyFulfillmentIntake {
  reconcile(input: ShopifyFulfillmentReference): Promise<ShopifyFulfillmentIntakeResult>;
}
export class ShopifyFulfillmentIntakeError extends Error {
  constructor() { super("Shopify fulfillment intake requires reconciliation"); this.name = "ShopifyFulfillmentIntakeError"; }
}
