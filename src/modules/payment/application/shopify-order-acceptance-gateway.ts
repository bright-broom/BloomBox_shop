import type { ShopifyOrderAcceptance, ShopifyOrderAcceptanceResult } from "@/modules/order/public";

/** Internal command: authoritative facts only, with protected address transfer confined to Infrastructure. */
export type ShopifyOrderAcceptanceRequest = Omit<ShopifyOrderAcceptance, "address"> & Readonly<{ test: boolean }>;
export type ShopifyOrderAcceptanceOutcome = ShopifyOrderAcceptanceResult | Readonly<{
  outcome: "HELD"; reason: "NOT_CONFIGURED" | "PREREQUISITES_UNRESOLVED" | "ORDER_CHANGED" | "SHIPPING_NOT_REQUIRED";
}>;
export interface ShopifyOrderAcceptanceGateway {
  acceptOrder(input: ShopifyOrderAcceptanceRequest): Promise<ShopifyOrderAcceptanceOutcome>;
}
