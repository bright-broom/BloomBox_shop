import { assessOrderPricing, type OrderPricingAssessment } from "@/modules/order/public";
import type { ShopifyOrderLink, ShopifyOrderLinker } from "@/modules/checkout/public";
import { evaluateSettlement, SettlementEvidenceConflictError, type SettlementSnapshot, type SettlementStatus } from "../domain/settlement-evidence";
import type { ReadShopifyReference } from "./read-shopify-reference";
import type { VerifiedProviderEvent } from "./receive-provider-webhook";
export type ShopifyPaymentEvidenceResult = Readonly<{ outcome: "APPLIED" | "DUPLICATE" | "STALE"; status: SettlementStatus; version: number }>;
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
  ) {}
  async execute(event: VerifiedProviderEvent): Promise<ShopifyPaymentEvidenceResult & { pricing: OrderPricingAssessment }> {
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
    const link = await this.linker.link({ shop: source.shop, orderId: order.id, apiVersion: source.apiVersion,
      cartToken: order.cartToken, lines: order.lines });
    const payment = await this.store.record(link, source.shop, snapshot);
    // A stale source must never authorize fresh commercial acceptance alongside newer stored payment facts.
    const pricing: OrderPricingAssessment = payment.outcome === "STALE"
      ? { status: "HELD", reason: "STALE_OBSERVATION" } : assessOrderPricing(order.pricing);
    return { ...payment, pricing };
  }
}
