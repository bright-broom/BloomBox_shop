import type { OrderPricingFacts } from "@/modules/order/public";
import type { Money } from "@/shared/domain/money";
import type { VerifiedProviderEvent } from "./receive-provider-webhook";

export type ShopifyReference = Readonly<{ shop: string; kind: "ORDER" | "REFUND"; id: string }>;
export type ShopifyTransaction = Readonly<{
  id: string;
  kind: "AUTHORIZATION" | "CAPTURE" | "CHANGE" | "EMV_AUTHORIZATION" | "REFUND" | "SALE" | "SUGGESTED_REFUND" | "VOID";
  status: "AWAITING_RESPONSE" | "ERROR" | "FAILURE" | "PENDING" | "SUCCESS" | "UNKNOWN";
  test: boolean;
  parentId: string | null;
  amount: Money;
}>;
export type ShopifyOrderSnapshot = Readonly<{
  id: string;
  /** Sensitive correlation data, for internal checkout matching only. */
  cartToken: string | null;
  updatedAt: string;
  test: boolean;
  cancelledAt: string | null;
  financialStatus: "AUTHORIZED" | "EXPIRED" | "PAID" | "PARTIALLY_PAID" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "VOIDED" | null;
  transactions: readonly ShopifyTransaction[];
  /** Invalid/missing commercial facts hold order pricing without discarding settlement facts. */
  pricing: OrderPricingFacts | null;
  originalTotal: Money;
  currentTotal: Money;
  received: Money;
  refunded: Money;
  lines: readonly Readonly<{ id: string; variantId: string | null; quantity: number; currentQuantity: number; originalUnitPrice: Money }>[];
}>;
export type ShopifyReferenceSnapshot = Readonly<{
  shop: string;
  apiVersion: string;
  order: ShopifyOrderSnapshot;
  refund: Readonly<{ id: string; updatedAt: string; transactions: readonly ShopifyTransaction[] }> | null;
}>;
export interface ShopifyOrderReader {
  read(reference: ShopifyReference): Promise<ShopifyReferenceSnapshot>;
}
export class InvalidShopifyReferenceError extends Error {
  constructor() { super("Shopify reference is invalid"); this.name = "InvalidShopifyReferenceError"; }
}
export class ShopifyOrderUnavailableError extends Error {
  constructor() { super("Shopify order data is unavailable"); this.name = "ShopifyOrderUnavailableError"; }
}
export class ShopifyOrderNotFoundError extends Error {
  constructor() { super("Shopify reference was not found in the configured shop"); this.name = "ShopifyOrderNotFoundError"; }
}

/** Read-only lookup. Does not claim/complete an Inbox event or authorize a purchase-intent link. */
export class ReadShopifyReference {
  constructor(private readonly reader: ShopifyOrderReader) {}

  async execute(event: VerifiedProviderEvent): Promise<ShopifyReferenceSnapshot> {
    const kind = event.eventType === "shopify.order.changed" ? "ORDER"
      : event.eventType === "shopify.refund.changed" ? "REFUND" : null;
    if (event.provider !== "SHOPIFY" || !kind || !event.externalObjectId
      || event.payload.id !== event.externalObjectId
      || event.payload.objectType !== (kind === "ORDER" ? "shopify_order_reference" : "shopify_refund_reference")) {
      throw new InvalidShopifyReferenceError();
    }
    return this.reader.read({ shop: event.providerAccountId, kind, id: event.externalObjectId });
  }
}
