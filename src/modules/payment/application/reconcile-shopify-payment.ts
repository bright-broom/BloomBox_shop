import { assessOrderPricing, type OrderPricingAssessment, type ShopifyAcceptedOrderQuery } from "@/modules/order/public";
import { assessDeliveryDate, type DeliveryDateAssessment } from "@/modules/fulfillment/public";
import type { ShopifyOrderLink, ShopifyOrderLinker, ShopifyDeliveryPlanQuery, ShopifyPurchaseConverter, ShopifyPurchaseConversion } from "@/modules/checkout/public";
import { evaluateSettlement, SettlementEvidenceConflictError, type SettlementSnapshot, type SettlementStatus } from "../domain/settlement-evidence";
import type { ShopifyDeliveryDestinationReader, ShopifyDestinationAssessment } from "./shopify-delivery-destination-reader";
import type { ReadShopifyReference } from "./read-shopify-reference";
import type { VerifiedProviderEvent } from "./receive-provider-webhook";
import type { ShopifyOrderAcceptanceGateway, ShopifyOrderAcceptanceOutcome } from "./shopify-order-acceptance-gateway";
import type { ShopifyOrderPaymentProjector, ShopifyOrderPaymentResult } from "./project-shopify-order-payment";
export type ShopifyOrderCompletionDependencies = Readonly<{
  orders: ShopifyAcceptedOrderQuery; payments: ShopifyOrderPaymentProjector; purchases: ShopifyPurchaseConverter;
}>;
export type ShopifyOrderCompletionResult = Readonly<{ outcome: "HELD"; reason: "NOT_CONFIGURED" | "ORDER_NOT_ACCEPTED" }>
  | Readonly<{ outcome: "COMPLETED"; payment: ShopifyOrderPaymentResult; purchase: { outcome: "CONVERTED" | "DUPLICATE" } }>;
export type ShopifyPaymentEvidenceResult = Readonly<{ outcome: "APPLIED" | "DUPLICATE" | "STALE"; status: SettlementStatus; version: number }>;
export type ShopifyDeliveryTimingAssessment = DeliveryDateAssessment | Readonly<{ status: "HELD"; reason:
  "STALE_OBSERVATION" | "ORDER_CANCELLED" | "PAYMENT_NOT_SETTLED" | "PAYMENT_PENDING" | "PRICING_UNRESOLVED"
  | "DELIVERY_PLAN_MISSING" | "PURCHASE_ALREADY_CONVERTED" | "PURCHASE_INACTIVE" | "PURCHASE_DETAILS_UNAVAILABLE" | "ORDER_ALREADY_ACCEPTED" }>;
export interface ShopifyPaymentEvidenceStore {
  record(link: ShopifyOrderLink, shop: string, snapshot: SettlementSnapshot): Promise<ShopifyPaymentEvidenceResult>;
}
export class ShopifyPaymentEvidencePersistenceError extends Error {
  constructor() { super("Shopify payment evidence could not be persisted"); this.name = "ShopifyPaymentEvidencePersistenceError"; }
}

/** Internal-only: do not mark the commerce Inbox complete before remaining order/fulfillment work exists. */
export class ReconcileShopifyPayment {
  constructor(
    private readonly reader: Pick<ReadShopifyReference, "execute">,
    private readonly linker: ShopifyOrderLinker,
    private readonly store: ShopifyPaymentEvidenceStore,
    private readonly expectedTestMode: boolean,
    private readonly deliveryPlans: ShopifyDeliveryPlanQuery,
    private readonly destinations: ShopifyDeliveryDestinationReader,
    private readonly now: () => Date = () => new Date(),
    private readonly acceptance?: ShopifyOrderAcceptanceGateway,
    private readonly completion?: ShopifyOrderCompletionDependencies,
  ) {}
  async execute(event: VerifiedProviderEvent): Promise<ShopifyPaymentEvidenceResult & { pricing: OrderPricingAssessment; deliveryTiming: ShopifyDeliveryTimingAssessment; destination: ShopifyDestinationAssessment; acceptance: ShopifyOrderAcceptanceOutcome; completion: ShopifyOrderCompletionResult }> {
    const source = await this.reader.execute(event);
    const order = source.order;
    if (order.test !== this.expectedTestMode || order.transactions.some((transaction) => transaction.test !== order.test)) {
      throw new SettlementEvidenceConflictError();
    }
    const snapshot: SettlementSnapshot = {
      updatedAt: order.updatedAt, cancelledAt: order.cancelledAt, test: order.test,
      requested: order.originalTotal.amount, received: order.received.amount, refunded: order.refunded.amount,
      transactions: order.transactions.map((transaction) => ({
        id: transaction.id, amount: transaction.amount.amount, parentId: transaction.parentId,
        kind: transaction.kind === "CHANGE" || transaction.kind === "EMV_AUTHORIZATION" || transaction.kind === "SUGGESTED_REFUND" ? "UNSUPPORTED" : transaction.kind,
        status: transaction.status === "SUCCESS" ? "SUCCEEDED" : transaction.status === "FAILURE" || transaction.status === "ERROR" ? "FAILED" : "PENDING",
      })),
    };
    evaluateSettlement(snapshot);
    // Once accepted, the scoped immutable receipt is the association authority. Current cart contents/PII are no longer prerequisites.
    const accepted = this.completion ? await this.completion.orders.find(source.shop, order.id) : null;
    const link = accepted ? { purchaseIntentId: accepted.purchaseIntentId, attemptId: accepted.attemptId, orderId: order.id }
      : await this.linker.link({ shop: source.shop, orderId: order.id, apiVersion: source.apiVersion, cartToken: order.cartToken, lines: order.lines });
    const payment = await this.store.record(link, source.shop, snapshot);
    // A stale source must never authorize fresh commercial acceptance alongside newer stored payment facts.
    const pricing: OrderPricingAssessment = payment.outcome === "STALE"
      ? { status: "HELD", reason: "STALE_OBSERVATION" } : assessOrderPricing(order.pricing);
    if (accepted) {
      const completion = await this.completeOrder({ ...accepted, shop: source.shop, externalOrderId: order.id });
      return { ...payment, pricing, deliveryTiming: { status: "HELD", reason: "ORDER_ALREADY_ACCEPTED" },
        destination: { status: "HELD", reason: "PREREQUISITES_UNRESOLVED" },
        acceptance: { outcome: "DUPLICATE", orderId: accepted.orderId, displayId: accepted.displayId }, completion };
    }
    let deliveryTiming = await this.assessDeliveryTiming(link, source.shop, snapshot, payment, pricing);
    let destination: ShopifyDestinationAssessment = deliveryTiming.status === "WITHIN_WINDOW"
      ? await this.destinations.assessDestination({ shop: source.shop, orderId: order.id, updatedAt: order.updatedAt, test: order.test })
      : { status: "HELD", reason: "PREREQUISITES_UNRESOLVED" };
    if (destination.status === "STRUCTURALLY_VALID_AND_COVERED") {
      // The protected-data request can cross a delivery or retention cutoff; re-read before returning a usable result.
      deliveryTiming = await this.assessDeliveryTiming(link, source.shop, snapshot, payment, pricing);
      if (deliveryTiming.status !== "WITHIN_WINDOW") destination = { status: "HELD", reason: "PREREQUISITES_UNRESOLVED" };
    }
    let acceptance: ShopifyOrderAcceptanceOutcome = { outcome: "HELD", reason: this.acceptance ? "PREREQUISITES_UNRESOLVED" : "NOT_CONFIGURED" };
    if (this.acceptance && destination.status === "STRUCTURALLY_VALID_AND_COVERED" && deliveryTiming.status === "WITHIN_WINDOW"
      && pricing.status === "MATCHED" && order.pricing && order.lines.length === 1 && order.lines[0].variantId) {
      acceptance = await this.acceptance.acceptOrder({ ...link, shop: source.shop, paymentVersion: payment.version,
        updatedAt: order.updatedAt, test: order.test, variantId: order.lines[0].variantId, pricing: order.pricing });
    }
    const completion = acceptance.outcome !== "HELD"
      ? await this.completeOrder({ ...link, orderId: acceptance.orderId, externalOrderId: order.id, shop: source.shop })
      : { outcome: "HELD" as const, reason: "ORDER_NOT_ACCEPTED" as const };
    return { ...payment, pricing, deliveryTiming, destination, acceptance, completion };
  }

  private async completeOrder(input: ShopifyPurchaseConversion): Promise<ShopifyOrderCompletionResult> {
    if (!this.completion) return { outcome: "HELD", reason: "NOT_CONFIGURED" };
    // Each owner commits independently. A failure is resumable from the immutable accepted-order lookup.
    const payment = await this.completion.payments.project(input);
    const purchase = await this.completion.purchases.convert(input);
    return { outcome: "COMPLETED", payment, purchase };
  }

  private async assessDeliveryTiming(link: ShopifyOrderLink, shop: string, source: SettlementSnapshot,
    payment: ShopifyPaymentEvidenceResult, pricing: OrderPricingAssessment): Promise<ShopifyDeliveryTimingAssessment> {
    if (payment.outcome === "STALE") return { status: "HELD", reason: "STALE_OBSERVATION" };
    if (source.cancelledAt !== null) return { status: "HELD", reason: "ORDER_CANCELLED" };
    if (payment.status !== "CAPTURED") return { status: "HELD", reason: "PAYMENT_NOT_SETTLED" };
    if (source.transactions.some((transaction) => transaction.status === "PENDING")) return { status: "HELD", reason: "PAYMENT_PENDING" };
    if (pricing.status !== "MATCHED") return { status: "HELD", reason: "PRICING_UNRESOLVED" };
    const plan = await this.deliveryPlans.find(link, shop);
    if (!plan) return { status: "HELD", reason: "DELIVERY_PLAN_MISSING" };
    if (plan.status === "CONVERTED") return { status: "HELD", reason: "PURCHASE_ALREADY_CONVERTED" };
    if (plan.status !== "CHECKOUT_CREATED") return { status: "HELD", reason: "PURCHASE_INACTIVE" };
    // Capture the clock after I/O, so a slow query cannot cross the cutoff unnoticed.
    const now = this.now();
    if (!Number.isFinite(plan.retentionExpiresAt.getTime())) throw new SettlementEvidenceConflictError();
    if (!plan.detailsAvailable || plan.retentionExpiresAt <= now) return { status: "HELD", reason: "PURCHASE_DETAILS_UNAVAILABLE" };
    return assessDeliveryDate(plan.deliveryDate, now);
  }

}
