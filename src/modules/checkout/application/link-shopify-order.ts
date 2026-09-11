import type { Money } from "@/shared/domain/money";

/** Internal authoritative-provider input. Never expose this write capability to browser-supplied facts. */
export type ShopifyOrderLinkInput = Readonly<{
  shop: string;
  orderId: string;
  apiVersion: string;
  /** Sensitive correlation token; never return it or include it in audit/Outbox payloads. */
  cartToken: string | null;
  lines: readonly Readonly<{ variantId: string | null; quantity: number; originalUnitPrice: Money }>[];
}>;
export type ShopifyOrderLink = Readonly<{ purchaseIntentId: string; attemptId: string; orderId: string }>;
export interface ShopifyOrderLinker {
  link(input: ShopifyOrderLinkInput): Promise<ShopifyOrderLink>;
}
export class ShopifyOrderLinkUnresolvedError extends Error {
  constructor() { super("Shopify order cannot be associated with a verified checkout attempt"); this.name = "ShopifyOrderLinkUnresolvedError"; }
}
export class ShopifyOrderLinkPersistenceError extends Error {
  constructor() { super("Shopify order association could not be persisted"); this.name = "ShopifyOrderLinkPersistenceError"; }
}
