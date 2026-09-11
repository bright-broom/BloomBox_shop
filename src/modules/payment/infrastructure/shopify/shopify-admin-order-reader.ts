import { z } from "zod";
import type { OrderPricingFacts } from "@/modules/order/public";
import { money } from "@/shared/domain/money";
import type { ShopifyAdminConfig } from "@/shared/infrastructure/config/shopify-admin-config";
import {
  InvalidShopifyReferenceError, ShopifyOrderNotFoundError, ShopifyOrderUnavailableError,
  type ShopifyOrderReader, type ShopifyReference, type ShopifyReferenceSnapshot,
} from "../../application/read-shopify-reference";

export const SHOPIFY_ADMIN_READ_TIMEOUT_MS = 5_000;
export const SHOPIFY_ADMIN_RESPONSE_MAX_BYTES = 256_000;
const MAX_ITEMS = 100;
const gid = (resource: string) => z.string().max(100).regex(new RegExp(`^gid://shopify/${resource}/[1-9]\\d*$`));
const date = z.iso.datetime({ offset: true });
const jpy = z.object({ currencyCode: z.literal("JPY"), amount: z.string().max(32)
  .regex(/^\d+(?:\.0+)?$/).transform(Number).refine(Number.isSafeInteger) });
const moneyBag = z.object({ shopMoney: jpy, presentmentMoney: jpy })
  .refine((value) => value.shopMoney.amount === value.presentmentMoney.amount)
  .transform((value) => money(value.shopMoney.amount));
const transactionSchema = z.object({
  id: gid("OrderTransaction"),
  kind: z.enum(["AUTHORIZATION", "CAPTURE", "CHANGE", "EMV_AUTHORIZATION", "REFUND", "SALE", "SUGGESTED_REFUND", "VOID"]),
  status: z.enum(["AWAITING_RESPONSE", "ERROR", "FAILURE", "PENDING", "SUCCESS", "UNKNOWN"]),
  parentTransaction: z.object({ id: gid("OrderTransaction") }).nullable(),
  test: z.boolean(), amountSet: moneyBag,
});
const orderSchema = z.object({
  id: gid("Order"), cartToken: z.string().min(1).max(128_000).nullable(), updatedAt: date, test: z.boolean(), cancelledAt: date.nullable(),
  displayFinancialStatus: z.enum(["AUTHORIZED", "EXPIRED", "PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "PENDING", "REFUNDED", "VOIDED"]).nullable(),
  originalTotalPriceSet: moneyBag, currentTotalPriceSet: moneyBag,
  totalReceivedSet: moneyBag, totalRefundedSet: moneyBag,
  transactions: z.array(transactionSchema).max(MAX_ITEMS)
    .refine((values) => new Set(values.map((value) => value.id)).size === values.length),
  lineItems: z.object({
    nodes: z.array(z.object({
      id: gid("LineItem"), variant: z.object({ id: gid("ProductVariant") }).nullable(),
      quantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      currentQuantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      originalUnitPriceSet: moneyBag,
    })).max(MAX_ITEMS),
    pageInfo: z.object({ hasNextPage: z.literal(false) }),
  }).refine((value) => new Set(value.nodes.map((line) => line.id)).size === value.nodes.length),
});
// Pricing is assessed independently: unusable commercial data must not erase valid settlement evidence.
const pricingSchema = z.object({
  taxesIncluded: z.boolean(), estimatedTaxes: z.boolean(), edited: z.boolean(),
  subtotalPriceSet: moneyBag, currentSubtotalPriceSet: moneyBag,
  totalTaxSet: moneyBag, currentTotalTaxSet: moneyBag,
  totalPriceSet: moneyBag, originalTotalPriceSet: moneyBag, currentTotalPriceSet: moneyBag,
  currentShippingPriceSet: moneyBag, originalTotalDutiesSet: moneyBag.nullable(), currentTotalDutiesSet: moneyBag.nullable(),
  originalTotalAdditionalFeesSet: moneyBag.nullable(), currentTotalAdditionalFeesSet: moneyBag.nullable(), totalTipReceivedSet: moneyBag,
  lineItems: z.object({ nodes: z.array(z.object({
    quantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currentQuantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), originalUnitPriceSet: moneyBag,
    discountAllocations: z.array(z.object({ allocatedAmountSet: moneyBag })).max(MAX_ITEMS),
  })).min(1).max(MAX_ITEMS), pageInfo: z.object({ hasNextPage: z.literal(false) }) }),
  shippingLines: z.object({ nodes: z.array(z.object({
    originalPriceSet: moneyBag, discountedPriceSet: moneyBag, currentDiscountedPriceSet: moneyBag, isRemoved: z.boolean(),
  })).max(MAX_ITEMS), pageInfo: z.object({ hasNextPage: z.literal(false) }) }),
}).transform((value): OrderPricingFacts => ({
  taxesIncluded: value.taxesIncluded, estimatedTaxes: value.estimatedTaxes, edited: value.edited,
  subtotal: value.subtotalPriceSet.amount, currentSubtotal: value.currentSubtotalPriceSet.amount,
  tax: value.totalTaxSet.amount, currentTax: value.currentTotalTaxSet.amount,
  total: value.totalPriceSet.amount, originalTotal: value.originalTotalPriceSet.amount, currentTotal: value.currentTotalPriceSet.amount,
  currentShipping: value.currentShippingPriceSet.amount,
  duties: value.originalTotalDutiesSet?.amount ?? 0, currentDuties: value.currentTotalDutiesSet?.amount ?? 0,
  additionalFees: value.originalTotalAdditionalFeesSet?.amount ?? 0, currentAdditionalFees: value.currentTotalAdditionalFeesSet?.amount ?? 0,
  tips: value.totalTipReceivedSet.amount,
  lines: value.lineItems.nodes.map((line) => ({ quantity: line.quantity, currentQuantity: line.currentQuantity,
    unitPrice: line.originalUnitPriceSet.amount, discounts: line.discountAllocations.map((allocation) => allocation.allocatedAmountSet.amount) })),
  shipping: value.shippingLines.nodes.map((line) => ({ originalPrice: line.originalPriceSet.amount, discountedPrice: line.discountedPriceSet.amount,
    currentDiscountedPrice: line.currentDiscountedPriceSet.amount, removed: line.isRemoved })),
}));
const refundSchema = z.object({
  id: gid("Refund"), updatedAt: date, order: orderSchema,
  transactions: z.object({
    nodes: z.array(transactionSchema).max(MAX_ITEMS),
    pageInfo: z.object({ hasNextPage: z.literal(false) }),
  }).refine((value) => new Set(value.nodes.map((transaction) => transaction.id)).size === value.nodes.length),
});
const envelopeSchema = z.object({
  errors: z.array(z.unknown()).length(0).optional(),
  data: z.object({ shop: z.object({ myshopifyDomain: z.string() }), node: z.unknown() }),
});
const MONEY_FIELDS = "shopMoney { amount currencyCode } presentmentMoney { amount currencyCode }";
const TRANSACTION_FIELDS = `id kind status test parentTransaction { id } amountSet { ${MONEY_FIELDS} }`;
const ORDER_FIELDS = `id cartToken updatedAt test cancelledAt displayFinancialStatus taxesIncluded estimatedTaxes edited
  subtotalPriceSet { ${MONEY_FIELDS} } currentSubtotalPriceSet { ${MONEY_FIELDS} }
  totalTaxSet { ${MONEY_FIELDS} } currentTotalTaxSet { ${MONEY_FIELDS} } totalPriceSet { ${MONEY_FIELDS} }
  currentShippingPriceSet { ${MONEY_FIELDS} }
  originalTotalDutiesSet { ${MONEY_FIELDS} } currentTotalDutiesSet { ${MONEY_FIELDS} }
  originalTotalAdditionalFeesSet { ${MONEY_FIELDS} } currentTotalAdditionalFeesSet { ${MONEY_FIELDS} }
  totalTipReceivedSet { ${MONEY_FIELDS} }
  shippingLines(first: ${MAX_ITEMS}) {
    nodes { isRemoved originalPriceSet { ${MONEY_FIELDS} } discountedPriceSet { ${MONEY_FIELDS} } currentDiscountedPriceSet { ${MONEY_FIELDS} } }
    pageInfo { hasNextPage }
  }
  transactions(first: ${MAX_ITEMS + 1}) { ${TRANSACTION_FIELDS} }
  originalTotalPriceSet { ${MONEY_FIELDS} } currentTotalPriceSet { ${MONEY_FIELDS} }
  totalReceivedSet { ${MONEY_FIELDS} } totalRefundedSet { ${MONEY_FIELDS} }
  lineItems(first: ${MAX_ITEMS}) {
    nodes { id quantity currentQuantity variant { id } originalUnitPriceSet { ${MONEY_FIELDS} } discountAllocations { allocatedAmountSet { ${MONEY_FIELDS} } } }
    pageInfo { hasNextPage }
  }`;
const QUERY = `query BloomBoxCommerceReference($id: ID!) {
  shop { myshopifyDomain }
  node(id: $id) {
    __typename
    ... on Order { ${ORDER_FIELDS} }
    ... on Refund {
      id updatedAt order { ${ORDER_FIELDS} }
      transactions(first: ${MAX_ITEMS}) {
        nodes { ${TRANSACTION_FIELDS} }
        pageInfo { hasNextPage }
      }
    }
  }
}`;

/** Disconnected, read-only provider boundary. Returned facts do not prove a local purchase-intent association. */
export class ShopifyAdminOrderReader implements ShopifyOrderReader {
  constructor(private readonly config: ShopifyAdminConfig, private readonly fetchImplementation: typeof fetch = fetch) {}

  async read(reference: ShopifyReference): Promise<ShopifyReferenceSnapshot> {
    if (reference.shop !== this.config.storeDomain
      || !["ORDER", "REFUND"].includes(reference.kind)
      || !gid(reference.kind === "ORDER" ? "Order" : "Refund").safeParse(reference.id).success) {
      throw new InvalidShopifyReferenceError();
    }
    try {
      const result = envelopeSchema.parse(await this.request(reference.id));
      if (result.data.shop.myshopifyDomain !== this.config.storeDomain) throw new ShopifyOrderUnavailableError();
      if (result.data.node === null) throw new ShopifyOrderNotFoundError();
      const expectedType = reference.kind === "ORDER" ? "Order" : "Refund";
      const node = z.object({ __typename: z.literal(expectedType), id: z.literal(reference.id) }).parse(result.data.node);
      const refund = node.__typename === "Refund" ? refundSchema.parse(result.data.node) : null;
      const order = refund ? refund.order : orderSchema.parse(result.data.node);
      const rawOrder = refund ? z.object({ order: z.unknown() }).parse(result.data.node).order : result.data.node;
      const pricing = pricingSchema.safeParse(rawOrder);
      return {
        shop: this.config.storeDomain, apiVersion: this.config.apiVersion,
        order: {
          id: order.id, cartToken: order.cartToken, updatedAt: order.updatedAt, test: order.test, cancelledAt: order.cancelledAt,
          transactions: order.transactions.map(mapTransaction), pricing: pricing.success ? pricing.data : null,
          financialStatus: order.displayFinancialStatus, originalTotal: order.originalTotalPriceSet,
          currentTotal: order.currentTotalPriceSet, received: order.totalReceivedSet, refunded: order.totalRefundedSet,
          lines: order.lineItems.nodes.map((line) => ({
            id: line.id, variantId: line.variant?.id ?? null, quantity: line.quantity,
            currentQuantity: line.currentQuantity, originalUnitPrice: line.originalUnitPriceSet,
          })),
        },
        refund: refund ? { id: refund.id, updatedAt: refund.updatedAt,
          transactions: refund.transactions.nodes.map(mapTransaction) } : null,
      };
    } catch (error) {
      if (error instanceof ShopifyOrderNotFoundError) throw error;
      throw new ShopifyOrderUnavailableError();
    }
  }

  private async request(id: string): Promise<unknown> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let response: Response | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new ShopifyOrderUnavailableError()); }, SHOPIFY_ADMIN_READ_TIMEOUT_MS);
    });
    try {
      response = await Promise.race([this.fetchImplementation(
        `https://${this.config.storeDomain}/admin/api/${this.config.apiVersion}/graphql.json`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.config.accessToken },
          body: JSON.stringify({ query: QUERY, variables: { id } }),
          signal: controller.signal, redirect: "error", cache: "no-store",
        }).then((result) => {
          // Also close a late response from a transport that ignored cancellation.
          if (controller.signal.aborted) {
            void result.body?.cancel().catch(() => { /* The deadline already owns this failure. */ });
            throw new ShopifyOrderUnavailableError();
          }
          return result;
        }), deadline]);
      if (!response.ok || !response.body || response.headers.get("x-shopify-api-version") !== this.config.apiVersion) {
        throw new ShopifyOrderUnavailableError();
      }
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > SHOPIFY_ADMIN_RESPONSE_MAX_BYTES)) {
        throw new ShopifyOrderUnavailableError();
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), deadline]);
        if (done) break;
        size += value.byteLength;
        if (size > SHOPIFY_ADMIN_RESPONSE_MAX_BYTES) throw new ShopifyOrderUnavailableError();
        chunks.push(value);
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) {
        void reader.cancel().catch(() => { /* Preserve the original read failure. */ });
        reader.releaseLock();
      } else if (response?.body) {
        void response.body.cancel().catch(() => { /* Preserve the original response failure. */ });
      }
    }
  }
}

function mapTransaction(transaction: z.infer<typeof transactionSchema>) {
  return { id: transaction.id, kind: transaction.kind, status: transaction.status,
    parentId: transaction.parentTransaction?.id ?? null, test: transaction.test, amount: transaction.amountSet };
}
