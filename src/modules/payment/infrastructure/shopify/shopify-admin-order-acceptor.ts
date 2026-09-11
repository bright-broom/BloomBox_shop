import { SHOPIFY_ORDER_ACCEPTANCE_POLICY, type ShopifyOrderAcceptancePolicy, type ShopifyOrderAcceptor } from "@/modules/order/public";
import { isApprovedDeliveryCoverage } from "@/modules/fulfillment/public";
import type { ShopifyOrderAcceptanceGateway, ShopifyOrderAcceptanceOutcome, ShopifyOrderAcceptanceRequest } from "../../application/shopify-order-acceptance-gateway";
import type { ShopifyAdminOrderReader } from "./shopify-admin-order-reader";

/** Fetch protected fields only for explicitly approved acceptance; do not expose them through application results. */
export class ShopifyAdminOrderAcceptor implements ShopifyOrderAcceptanceGateway {
  constructor(private readonly reader: Pick<ShopifyAdminOrderReader, "readAcceptanceDestination">,
    private readonly orders: ShopifyOrderAcceptor,
    private readonly policy: ShopifyOrderAcceptancePolicy = SHOPIFY_ORDER_ACCEPTANCE_POLICY) {}

  async acceptOrder(input: ShopifyOrderAcceptanceRequest): Promise<ShopifyOrderAcceptanceOutcome> {
    if (this.policy.approval !== "APPROVED" || !isApprovedDeliveryCoverage(this.policy.coverage)) {
      return { outcome: "HELD", reason: "TERMS_NOT_APPROVED" };
    }
    if (input.test !== this.policy.testMode || input.pricing.taxesIncluded !== this.policy.taxesIncluded) {
      return { outcome: "HELD", reason: "TERMS_MISMATCH" };
    }
    const destination = await this.reader.readAcceptanceDestination(input);
    if (destination.status === "HELD") {
      return { outcome: "HELD", reason: destination.reason === "ORDER_CHANGED" || destination.reason === "SHIPPING_NOT_REQUIRED"
        ? destination.reason : "ADDRESS_UNRESOLVED" };
    }
    // Order rechecks linked identity, pricing, payment version, coverage and the clock under its DB locks.
    // Leave persistence errors intact: payment evidence has already committed, and the caller must retry.
    return this.orders.accept({ purchaseIntentId: input.purchaseIntentId, attemptId: input.attemptId,
      shop: input.shop, orderId: input.orderId, paymentVersion: input.paymentVersion, updatedAt: input.updatedAt,
      variantId: input.variantId, pricing: input.pricing, address: destination.address });
  }
}
