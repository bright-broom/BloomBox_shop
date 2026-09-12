import { z } from "zod";
import { ShopifyAllocatedStockReader } from "./shopify-allocated-stock-reader";
import { ShopifyFulfillmentUnavailableError, type ShopifyFulfillmentReader, type ShopifyFulfillmentSnapshot, type ShopifyFulfillmentQuantities } from "@/modules/fulfillment/public";
import { DELIVERY_ADDRESS_TEXT_MAX_LENGTH, DELIVERY_POSTAL_INPUT_MAX_LENGTH, JAPAN_PREFECTURES, assessDeliveryDestination, isApprovedDeliveryCoverage, DELIVERY_COVERAGE_POLICY, type DeliveryCoveragePolicy } from "@/modules/fulfillment/public";
import { ShopifyDeliveryDestinationUnavailableError, type ShopifyDeliveryDestinationReader, type ShopifyDestinationReference, type ShopifyDestinationAssessment } from "../../application/shopify-delivery-destination-reader";
import type { OrderPricingFacts, ShopifyOrderAcceptance } from "@/modules/order/public";
import { money } from "@/shared/domain/money";
import type { ShopifyAdminConfig } from "@/shared/infrastructure/config/shopify-admin-config";
import {
  InvalidShopifyReferenceError, ShopifyOrderNotFoundError, ShopifyOrderUnavailableError,
  type ShopifyOrderReader, type ShopifyReference, type ShopifyReferenceSnapshot,
} from "../../application/read-shopify-reference";

export const SHOPIFY_ADMIN_READ_TIMEOUT_MS = 5_000;
export const SHOPIFY_ADMIN_RESPONSE_MAX_BYTES = 256_000;
const MAX_ITEMS = 100;
// Bound the nested query cost as well as the response bytes; oversized orders require a separate reconciliation path.
const MAX_FULFILLMENTS = 10;
const MAX_FULFILLMENT_LINES = 20;
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
    taxLines: z.array(z.object({ priceSet: moneyBag })).max(MAX_ITEMS),
    discountAllocations: z.array(z.object({ allocatedAmountSet: moneyBag })).max(MAX_ITEMS),
  })).min(1).max(MAX_ITEMS), pageInfo: z.object({ hasNextPage: z.literal(false) }) }),
  shippingLines: z.object({ nodes: z.array(z.object({
    originalPriceSet: moneyBag, discountedPriceSet: moneyBag, currentDiscountedPriceSet: moneyBag, isRemoved: z.boolean(),
    taxLines: z.array(z.object({ priceSet: moneyBag })).max(MAX_ITEMS),
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
    unitPrice: line.originalUnitPriceSet.amount, taxes: line.taxLines.map((tax) => tax.priceSet.amount), discounts: line.discountAllocations.map((allocation) => allocation.allocatedAmountSet.amount) })),
  shipping: value.shippingLines.nodes.map((line) => ({ originalPrice: line.originalPriceSet.amount, discountedPrice: line.discountedPriceSet.amount,
    currentDiscountedPrice: line.currentDiscountedPriceSet.amount, taxes: line.taxLines.map((tax) => tax.priceSet.amount), removed: line.isRemoved })),
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
    nodes { taxLines { priceSet { ${MONEY_FIELDS} } } isRemoved originalPriceSet { ${MONEY_FIELDS} } discountedPriceSet { ${MONEY_FIELDS} } currentDiscountedPriceSet { ${MONEY_FIELDS} } }
    pageInfo { hasNextPage }
  }
  transactions(first: ${MAX_ITEMS + 1}) { ${TRANSACTION_FIELDS} }
  originalTotalPriceSet { ${MONEY_FIELDS} } currentTotalPriceSet { ${MONEY_FIELDS} }
  totalReceivedSet { ${MONEY_FIELDS} } totalRefundedSet { ${MONEY_FIELDS} }
  lineItems(first: ${MAX_ITEMS}) {
    nodes { taxLines(first: ${MAX_ITEMS + 1}) { priceSet { ${MONEY_FIELDS} } } id quantity currentQuantity variant { id } originalUnitPriceSet { ${MONEY_FIELDS} } discountAllocations { allocatedAmountSet { ${MONEY_FIELDS} } } }
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

const DESTINATION_QUERY = `query BloomBoxDeliveryDestination($id: ID!) {
  shop { myshopifyDomain }
  node(id: $id) { __typename ... on Order {
    id updatedAt test cancelledAt requiresShipping
    shippingAddress { countryCodeV2 provinceCode zip name city address1 }
  } }
}`;
const FULFILLMENT_QUERY = `query BloomBoxFulfillmentObservation($id: ID!) {
  shop { myshopifyDomain }
  node(id: $id) { __typename ... on Order {
    id test updatedAt fulfillmentsCount { count precision }
    lineItems(first: ${MAX_ITEMS}) { nodes { id quantity currentQuantity variant { id } } pageInfo { hasNextPage } }
    fulfillments(first: ${MAX_FULFILLMENTS + 1}) { id status updatedAt inTransitAt deliveredAt order { id } totalQuantity
      fulfillmentLineItems(first: ${MAX_FULFILLMENT_LINES}) { nodes { id quantity lineItem { id } } pageInfo { hasNextPage } }
    }
  } }
}`;
const fulfillmentOrderSchema = z.object({
  __typename: z.literal("Order"), id: gid("Order"), test: z.boolean(),
  fulfillmentsCount: z.object({ count: z.number().int().nonnegative().max(MAX_FULFILLMENTS), precision: z.literal("EXACT") }),
  fulfillments: z.array(z.object({ id: gid("Fulfillment"), order: z.object({ id: gid("Order") }),
    status: z.enum(["CANCELLED", "ERROR", "FAILURE", "SUCCESS", "OPEN", "PENDING"]),
    updatedAt: date, inTransitAt: date.nullable(), deliveredAt: date.nullable(),
  })).max(MAX_FULFILLMENTS),
}).refine((order) => order.fulfillmentsCount.count === order.fulfillments.length
  && new Set(order.fulfillments.map((item) => item.id)).size === order.fulfillments.length
  && order.fulfillments.every((item) => item.order.id === order.id));
const fulfillmentQuantitySchema = z.object({
  updatedAt: date,
  lineItems: z.object({ nodes: z.array(z.object({ id: gid("LineItem"), variant: z.object({ id: gid("ProductVariant") }).nullable(),
    quantity: z.number().int().positive().max(2_147_483_647), currentQuantity: z.number().int().nonnegative().max(2_147_483_647),
  })).min(1).max(MAX_ITEMS), pageInfo: z.object({ hasNextPage: z.literal(false) }) }),
  fulfillments: z.array(z.object({ id: gid("Fulfillment"), totalQuantity: z.number().int().positive().max(2_147_483_647),
    fulfillmentLineItems: z.object({ nodes: z.array(z.object({ id: gid("FulfillmentLineItem"),
      quantity: z.number().int().positive().max(2_147_483_647), lineItem: z.object({ id: gid("LineItem") }),
    })).min(1).max(MAX_FULFILLMENT_LINES), pageInfo: z.object({ hasNextPage: z.literal(false) }) }),
  })).max(MAX_FULFILLMENTS),
}).refine((source) => new Set(source.lineItems.nodes.map((line) => line.id)).size === source.lineItems.nodes.length
  && source.fulfillments.every((item) => item.fulfillmentLineItems.nodes.reduce((sum, line) => sum + line.quantity, 0) === item.totalQuantity)
  && new Set(source.fulfillments.flatMap((item) => item.fulfillmentLineItems.nodes.map((line) => line.id))).size
    === source.fulfillments.reduce((sum, item) => sum + item.fulfillmentLineItems.nodes.length, 0));
const addressText = z.string().max(DELIVERY_ADDRESS_TEXT_MAX_LENGTH).nullable();
const destinationSchema = z.object({
  __typename: z.literal("Order"), id: gid("Order"), updatedAt: date, test: z.boolean(), cancelledAt: date.nullable(), requiresShipping: z.boolean(),
  shippingAddress: z.object({ countryCodeV2: z.string().max(2).nullable(), provinceCode: z.string().max(20).nullable(),
    zip: z.string().max(DELIVERY_POSTAL_INPUT_MAX_LENGTH).nullable(), name: addressText, city: addressText, address1: addressText }).nullable(),
});
const ACCEPTANCE_DESTINATION_QUERY = `query BloomBoxAcceptanceDestination($id: ID!) {
  shop { myshopifyDomain }
  node(id: $id) { __typename ... on Order {
    id updatedAt test cancelledAt requiresShipping
    shippingAddress { countryCodeV2 provinceCode zip name city address1 address2 phone }
  } }
}`;
const acceptanceDestinationSchema = destinationSchema.extend({
  shippingAddress: destinationSchema.shape.shippingAddress.unwrap().extend({
    address2: addressText, phone: z.string().max(32).nullable(),
  }).nullable(),
});
type AcceptanceDestination = Readonly<{ status: "READY"; address: ShopifyOrderAcceptance["address"] }>
  | Extract<ShopifyDestinationAssessment, { status: "HELD" }>;

/** Disconnected, read-only provider boundary. Returned facts do not prove a local purchase-intent association. */
export class ShopifyAdminOrderReader implements ShopifyOrderReader, ShopifyDeliveryDestinationReader, ShopifyFulfillmentReader {
  constructor(private readonly config: ShopifyAdminConfig, private readonly fetchImplementation: typeof fetch = fetch,
    private readonly coverage: DeliveryCoveragePolicy = DELIVERY_COVERAGE_POLICY) {}

  async readFulfillmentStock(reference: Readonly<{ shop: string; orderId: string; test: boolean }>) {
    return new ShopifyAllocatedStockReader(this.config.storeDomain, (id, query, locationId) => this.request(id, query, locationId)).readFulfillmentStock(reference);
  }

  /** No address, tracking number or tracking URL is requested. Any fulfillment is activity, even a cancelled one. */
  async readFulfillments(reference: Readonly<{ shop: string; orderId: string; test: boolean }>): Promise<ShopifyFulfillmentSnapshot> {
    try {
      if (reference.shop !== this.config.storeDomain || !gid("Order").safeParse(reference.orderId).success
        || typeof reference.test !== "boolean") throw new ShopifyFulfillmentUnavailableError();
      const envelope = envelopeSchema.parse(await this.request(reference.orderId, FULFILLMENT_QUERY));
      const order = fulfillmentOrderSchema.parse(envelope.data.node);
      if (envelope.data.shop.myshopifyDomain !== reference.shop || order.id !== reference.orderId || order.test !== reference.test) {
        throw new ShopifyFulfillmentUnavailableError();
      }
      const fulfillments = order.fulfillments.map(({ id, status, updatedAt, inTransitAt, deliveredAt }) => ({ id, status, updatedAt, inTransitAt, deliveredAt }));
      // Missing quantity evidence must not erase the separate activity witness or permit a complete-delivery claim.
      const parsed = fulfillmentQuantitySchema.safeParse(envelope.data.node);
      const quantities: ShopifyFulfillmentQuantities | null = parsed.success ? { updatedAt: parsed.data.updatedAt,
        lines: parsed.data.lineItems.nodes.map((line) => ({ id: line.id, variantId: line.variant?.id ?? null,
          quantity: line.quantity, currentQuantity: line.currentQuantity })),
        fulfillments: fulfillments.map((item, index) => ({ ...item, lines: parsed.data.fulfillments[index].fulfillmentLineItems.nodes.map((line) => ({
          id: line.id, lineItemId: line.lineItem.id, quantity: line.quantity,
        })) })),
      } : null;
      return { shop: reference.shop, orderId: order.id, test: order.test, fulfillments, quantities };
    } catch { throw new ShopifyFulfillmentUnavailableError(); }
  }

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

  /** Separate protected-data read: errors cannot roll back the earlier settlement write. Returns no address text. */
  async assessDestination(reference: ShopifyDestinationReference): Promise<ShopifyDestinationAssessment> {
    if (reference.shop !== this.config.storeDomain || !gid("Order").safeParse(reference.orderId).success
      || !date.safeParse(reference.updatedAt).success || typeof reference.test !== "boolean") throw new InvalidShopifyReferenceError();
    // Unapproved/invalid coverage cannot justify fetching a recipient's protected address.
    if (!isApprovedDeliveryCoverage(this.coverage)) return assessDeliveryDestination(null, this.coverage);
    try {
      const envelope = envelopeSchema.parse(await this.request(reference.orderId, DESTINATION_QUERY));
      if (envelope.data.shop.myshopifyDomain !== reference.shop) throw new ShopifyDeliveryDestinationUnavailableError();
      const order = destinationSchema.parse(envelope.data.node);
      if (order.id !== reference.orderId || order.test !== reference.test) throw new ShopifyDeliveryDestinationUnavailableError();
      if (new Date(order.updatedAt).getTime() !== new Date(reference.updatedAt).getTime() || order.cancelledAt !== null) {
        return { status: "HELD", reason: "ORDER_CHANGED" };
      }
      if (!order.requiresShipping) return { status: "HELD", reason: "SHIPPING_NOT_REQUIRED" };
      const address = order.shippingAddress;
      return assessDeliveryDestination(address ? { countryCode: address.countryCodeV2, prefecture: japanesePrefecture(address.provinceCode),
        postalCode: address.zip, recipientName: address.name, city: address.city, addressLine: address.address1 } : null, this.coverage);
    } catch {
      throw new ShopifyDeliveryDestinationUnavailableError();
    }
  }

  /** Infrastructure-only PII transfer to the acceptance command, never a public application query. */
  async readAcceptanceDestination(reference: ShopifyDestinationReference): Promise<AcceptanceDestination> {
    if (reference.shop !== this.config.storeDomain || !gid("Order").safeParse(reference.orderId).success
      || !date.safeParse(reference.updatedAt).success || typeof reference.test !== "boolean") throw new InvalidShopifyReferenceError();
    if (!isApprovedDeliveryCoverage(this.coverage)) return { status: "HELD", reason: "COVERAGE_NOT_APPROVED" };
    try {
      const envelope = envelopeSchema.parse(await this.request(reference.orderId, ACCEPTANCE_DESTINATION_QUERY));
      if (envelope.data.shop.myshopifyDomain !== reference.shop) throw new ShopifyDeliveryDestinationUnavailableError();
      const order = acceptanceDestinationSchema.parse(envelope.data.node);
      if (order.id !== reference.orderId || order.test !== reference.test) throw new ShopifyDeliveryDestinationUnavailableError();
      if (Date.parse(order.updatedAt) !== Date.parse(reference.updatedAt) || order.cancelledAt !== null) return { status: "HELD", reason: "ORDER_CHANGED" };
      if (!order.requiresShipping) return { status: "HELD", reason: "SHIPPING_NOT_REQUIRED" };
      const raw = order.shippingAddress;
      if (!raw) return { status: "HELD", reason: "ADDRESS_MISSING" };
      const address = { countryCode: raw.countryCodeV2, prefecture: japanesePrefecture(raw.provinceCode),
        postalCode: raw.zip, recipientName: raw.name, city: raw.city, addressLine: raw.address1,
        addressLine2: raw.address2, phone: raw.phone };
      const assessment = assessDeliveryDestination(address, this.coverage);
      return assessment.status === "HELD" ? assessment : { status: "READY", address };
    } catch {
      throw new ShopifyDeliveryDestinationUnavailableError();
    }
  }

  private async request(id: string, query = QUERY, locationId?: string): Promise<unknown> {
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
          body: JSON.stringify({ query, variables: { id, ...(locationId ? { locationId } : {}) } }),
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

// Shopify uses ISO 3166-2 JP-01..JP-47; the shared prefecture list follows that standard order.
function japanesePrefecture(code: string | null): string | null {
  if (!code || !/^JP-(0[1-9]|[1-3]\d|4[0-7])$/.test(code)) return null;
  return JAPAN_PREFECTURES[Number(code.slice(3)) - 1] ?? null;
}
