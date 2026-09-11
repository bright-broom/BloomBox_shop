import { ShopifyDeliveryDestinationUnavailableError } from "../../application/shopify-delivery-destination-reader";
import { ReconcileShopifyPayment } from "../../application/reconcile-shopify-payment";
import { SettlementEvidenceConflictError } from "../../domain/settlement-evidence";
import { AssociateShopifyOrder } from "../../application/associate-shopify-order";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InvalidShopifyReferenceError, ShopifyOrderNotFoundError, ShopifyOrderUnavailableError,
  ReadShopifyReference,
} from "../../application/read-shopify-reference";
import { ShopifyWebhookVerifier } from "../shopify-webhook-verifier";
import { createHmac } from "node:crypto";
import { ShopifyAdminOrderReader, SHOPIFY_ADMIN_READ_TIMEOUT_MS, SHOPIFY_ADMIN_RESPONSE_MAX_BYTES } from "./shopify-admin-order-reader";

const config = { storeDomain: "bloom-test.myshopify.com", accessToken: "isolated-admin-token", apiVersion: "2026-07" } as const;
const orderId = "gid://shopify/Order/9007199254740993";
const refundId = "gid://shopify/Refund/9007199254740995";
const reference = { shop: config.storeDomain, kind: "ORDER", id: orderId } as const;
const bag = (amount: string) => ({ shopMoney: { amount, currencyCode: "JPY" }, presentmentMoney: { amount, currencyCode: "JPY" } });
function order() {
  return {
    __typename: "Order", id: orderId, cartToken: "opaque-cart-token", updatedAt: "2026-09-11T10:00:00Z", test: true, cancelledAt: null,
    transactions: [], displayFinancialStatus: "PAID", originalTotalPriceSet: bag("8000.00"), currentTotalPriceSet: bag("7500"),
    totalReceivedSet: bag("8000"), totalRefundedSet: bag("500"),
    lineItems: { nodes: [{ id: "gid://shopify/LineItem/31", variant: { id: "gid://shopify/ProductVariant/41" }, quantity: 1, currentQuantity: 1, originalUnitPriceSet: bag("8000") }], pageInfo: { hasNextPage: false } },
  };
}
function pricedOrder() {
  const original = order();
  return { ...original, taxesIncluded: true, estimatedTaxes: false, edited: false,
    currentTotalPriceSet: bag("8000"), totalPriceSet: bag("8000"), totalRefundedSet: bag("0"),
    subtotalPriceSet: bag("8000"), currentSubtotalPriceSet: bag("8000"), totalTaxSet: bag("727"), currentTotalTaxSet: bag("727"),
    currentShippingPriceSet: bag("0"), originalTotalDutiesSet: null, currentTotalDutiesSet: null,
    originalTotalAdditionalFeesSet: null, currentTotalAdditionalFeesSet: null, totalTipReceivedSet: bag("0"),
    lineItems: { ...original.lineItems, nodes: original.lineItems.nodes.map((line) => ({ ...line, discountAllocations: [] })) },
    shippingLines: { nodes: [{ originalPriceSet: bag("0"), discountedPriceSet: bag("0"), currentDiscountedPriceSet: bag("0"), isRemoved: false }], pageInfo: { hasNextPage: false } },
    transactions: [{ id: "gid://shopify/OrderTransaction/61", kind: "SALE", status: "SUCCESS", test: true, parentTransaction: null, amountSet: bag("8000") }],
  };
}
const approvedCoverage = { approval: "APPROVED", prefectures: ["東京都", "北海道", "沖縄県"], excludedPostalPrefixes: ["10021"] } as const;
const destinationReference = { shop: config.storeDomain, orderId, updatedAt: "2026-09-11T10:00:00Z", test: true };
function destinationOrder() {
  return { __typename: "Order", id: orderId, updatedAt: destinationReference.updatedAt, test: true, cancelledAt: null, requiresShipping: true,
    shippingAddress: { countryCodeV2: "JP", provinceCode: "JP-13", zip: "100-0001", name: "宛名の秘密", city: "市区町村の秘密", address1: "番地の秘密" } };
}
function refund(status = "PENDING") {
  return { __typename: "Refund", id: refundId, updatedAt: "2026-09-11T10:01:00Z", order: order(), transactions: {
    nodes: [{ id: "gid://shopify/OrderTransaction/51", kind: "REFUND", status, parentTransaction: null, test: true, amountSet: bag("500") }],
    pageInfo: { hasNextPage: false },
  } };
}
function response(node: unknown = order(), options: { shop?: string; errors?: unknown[]; status?: number; version?: string } = {}) {
  return Response.json({ data: { shop: { myshopifyDomain: options.shop ?? config.storeDomain }, node }, ...(options.errors ? { errors: options.errors } : {}) },
    { status: options.status ?? 200, headers: { "x-shopify-api-version": options.version ?? config.apiVersion } });
}
function client(result: Response = response()) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(result);
  return { reader: new ShopifyAdminOrderReader(config, fetcher), fetcher };
}

afterEach(() => vi.useRealTimers());
describe("Shopify authenticated order lookup", () => {
  it("fetches one read-only query from the pinned shop and preserves safe integer JPY amounts", async () => {
    const { reader, fetcher } = client(response({ ...order(), email: "private@example.test", note: "gift secret" }));
    const result = await reader.read(reference);
    expect(result).toMatchObject({ shop: config.storeDomain, refund: null, order: {
      id: orderId, originalTotal: { amount: 8000, currency: "JPY" }, currentTotal: { amount: 7500 },
      received: { amount: 8000 }, refunded: { amount: 500 }, test: true,
    } });
    expect(JSON.stringify(result)).not.toMatch(/private|gift secret/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe(`https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`);
    expect(request).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", headers: { "X-Shopify-Access-Token": config.accessToken } });
    const body = JSON.parse(String(request?.body));
    expect(body.variables).toEqual({ id: orderId });
    expect(body.query).toMatch(/^query /); expect(body.query).not.toMatch(/mutation|email|address|note|customAttributes|receiptJson/);
  });
  it.each(["PENDING", "SUCCESS", "FAILURE", "ERROR", "UNKNOWN", "AWAITING_RESPONSE"])("preserves refund transaction %s without claiming refund completion", async (status) => {
    const { reader } = client(response(refund(status)));
    const result = await reader.read({ ...reference, kind: "REFUND", id: refundId });
    expect(result.refund?.transactions).toEqual([{ id: "gid://shopify/OrderTransaction/51", kind: "REFUND", status, parentId: null, test: true, amount: { amount: 500, currency: "JPY" } }]);
    expect(result.order.id).toBe(orderId);
  });
  it.each([
    { shop: "other.myshopify.com" }, { id: "gid://shopify/Order/1?secret=leak" },
    { id: "gid://shopify/Refund/1" }, { id: "not-an-id" },
  ])("rejects wrong scope or ID before network access: %j", async (overrides) => {
    const { reader, fetcher } = client();
    await expect(reader.read({ ...reference, ...overrides })).rejects.toBeInstanceOf(InvalidShopifyReferenceError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("distinguishes missing objects from transport failure without accepting a missing object", async () => {
    await expect(client(response(null)).reader.read(reference)).rejects.toBeInstanceOf(ShopifyOrderNotFoundError);
    await expect(client(response(order(), { status: 403 })).reader.read(reference)).rejects.toBeInstanceOf(ShopifyOrderUnavailableError);
  });
  it.each([
    { shop: "other.myshopify.com" }, { version: "2026-04" }, { errors: [{ message: "sensitive server detail" }] },
    { status: 429 }, { status: 500 }, { status: 302 },
  ])("rejects wrong tenant/version, partial GraphQL errors, and HTTP failures: %j", async (options) => {
    const { reader, fetcher } = client(response(order(), options));
    await expect(reader.read(reference)).rejects.toThrow("Shopify order data is unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { id: "gid://shopify/Order/2" }, { __typename: "Refund" }, { updatedAt: "bad date" },
    { displayFinancialStatus: "NEW_UNKNOWN_STATUS" }, { test: "false" },
    { originalTotalPriceSet: bag("0.1") }, { originalTotalPriceSet: bag("9007199254740993") },
    { originalTotalPriceSet: bag("-1") }, { originalTotalPriceSet: { ...bag("8000"), shopMoney: { amount: "8000", currencyCode: "USD" } } },
    { originalTotalPriceSet: { ...bag("8000"), presentmentMoney: { amount: "7000", currencyCode: "JPY" } } },
  ])("rejects mismatched or malformed authoritative facts: %j", async (overrides) => {
    await expect(client(response({ ...order(), ...overrides })).reader.read(reference)).rejects.toBeInstanceOf(ShopifyOrderUnavailableError);
  });
  it("rejects incomplete or duplicated order lines and refund transactions", async () => {
    const original = order();
    for (const lineItems of [
      { ...original.lineItems, pageInfo: { hasNextPage: true } },
      { ...original.lineItems, nodes: [original.lineItems.nodes[0], original.lineItems.nodes[0]] },
      { ...original.lineItems, nodes: Array.from({ length: 101 }, (_, i) => ({ ...original.lineItems.nodes[0], id: `gid://shopify/LineItem/${i + 1}` })) },
    ]) await expect(client(response({ ...original, lineItems })).reader.read(reference)).rejects.toBeInstanceOf(ShopifyOrderUnavailableError);
    const refunded = refund();
    for (const transactions of [
      { ...refunded.transactions, pageInfo: { hasNextPage: true } },
      { ...refunded.transactions, nodes: [refunded.transactions.nodes[0], refunded.transactions.nodes[0]] },
    ]) await expect(client(response({ ...refunded, transactions })).reader.read({ ...reference, kind: "REFUND", id: refundId })).rejects.toBeInstanceOf(ShopifyOrderUnavailableError);
  });
  it("retains nullable status and deleted variants for downstream manual review", async () => {
    const original = order();
    const { reader } = client(response({ ...original, displayFinancialStatus: null, lineItems: { ...original.lineItems, nodes: [{ ...original.lineItems.nodes[0], variant: null }] } }));
    expect((await reader.read(reference)).order).toMatchObject({ financialStatus: null, lines: [{ variantId: null }] });
  });
  it("bounds actual streamed bytes and cancels an oversized response", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(150_000)); }, cancel });
    const { reader } = client(new Response(stream, { headers: { "x-shopify-api-version": config.apiVersion, "content-length": "2" } }));
    await expect(reader.read(reference)).rejects.toBeInstanceOf(ShopifyOrderUnavailableError);
    expect(cancel).toHaveBeenCalled();
  });
  it("rejects an oversized declared length before consuming the stream", async () => {
    const cancel = vi.fn();
    const { reader } = client(new Response(new ReadableStream({ cancel }), { headers: { "x-shopify-api-version": config.apiVersion, "content-length": String(SHOPIFY_ADMIN_RESPONSE_MAX_BYTES + 1) } }));
    await expect(reader.read(reference)).rejects.toBeInstanceOf(ShopifyOrderUnavailableError); expect(cancel).toHaveBeenCalled();
  });
  it("enforces a deadline even if the transport ignores abort", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const pending = expect(new ShopifyAdminOrderReader(config, fetcher).read(reference)).rejects.toBeInstanceOf(ShopifyOrderUnavailableError);
    await vi.advanceTimersByTimeAsync(SHOPIFY_ADMIN_READ_TIMEOUT_MS + 1); await pending;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("closes a response that arrives after its deadline", async () => {
    vi.useFakeTimers();
    let resolveFetch: (value: Response) => void = () => { throw new Error("Fetch did not start"); };
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const pending = expect(new ShopifyAdminOrderReader(config, fetcher).read(reference)).rejects.toBeInstanceOf(ShopifyOrderUnavailableError);
    await vi.advanceTimersByTimeAsync(SHOPIFY_ADMIN_READ_TIMEOUT_MS + 1); await pending;
    const cancel = vi.fn();
    resolveFetch(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("redacts network failures and leaves retry to the caller", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private token and provider message"));
    await expect(new ShopifyAdminOrderReader(config, fetcher).read(reference)).rejects.toThrow("Shopify order data is unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("times out a stalled body without waiting forever for cancellation", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
    const { reader } = client(new Response(new ReadableStream({ cancel }), { headers: { "x-shopify-api-version": config.apiVersion } }));
    const pending = expect(reader.read(reference)).rejects.toBeInstanceOf(ShopifyOrderUnavailableError);
    await vi.advanceTimersByTimeAsync(SHOPIFY_ADMIN_READ_TIMEOUT_MS + 1); await pending;
    expect(cancel).toHaveBeenCalled();
  });
  it.each([Buffer.from("{"), Buffer.from([0xff])])("rejects malformed JSON/UTF-8 without leaking provider details", async (bytes) => {
    const { reader } = client(new Response(bytes, { headers: { "x-shopify-api-version": config.apiVersion } }));
    await expect(reader.read(reference)).rejects.toThrow("Shopify order data is unavailable");
  });
  it("reconciles complete authenticated transactions, rejecting mode and monetary mismatches before writes", async () => {
    const paidOrder = { ...order(), transactions: [
      { id: "gid://shopify/OrderTransaction/61", kind: "SALE", status: "SUCCESS", test: true, parentTransaction: null, amountSet: bag("8000") },
      { id: "gid://shopify/OrderTransaction/62", kind: "REFUND", status: "SUCCESS", test: true, parentTransaction: { id: "gid://shopify/OrderTransaction/61" }, amountSet: bag("500") },
    ] };
    const { reader, fetcher } = client(); fetcher.mockImplementation(async () => response(paidOrder));
    const event = { provider: "SHOPIFY" as const, providerAccountId: config.storeDomain, eventType: "shopify.order.changed", externalEventId: "verified-body-digest", externalObjectId: orderId,
      apiVersion: config.apiVersion, occurredAt: new Date(), payload: { id: orderId, objectType: "shopify_order_reference" } };
    const link = vi.fn().mockResolvedValue({ purchaseIntentId: "intent", attemptId: "attempt", orderId });
    const record = vi.fn().mockResolvedValue({ outcome: "APPLIED", status: "PARTIALLY_REFUNDED", version: 1 });
    const useCase = new ReconcileShopifyPayment(new ReadShopifyReference(reader), { link }, { record }, true, { find: async () => null }, reader);
    expect(await useCase.execute(event)).toMatchObject({ status: "PARTIALLY_REFUNDED" });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ orderId }), config.storeDomain, expect.objectContaining({ received: 8000, refunded: 500, transactions: expect.arrayContaining([expect.objectContaining({ kind: "REFUND", status: "SUCCEEDED", amount: 500 })]) }));
    expect(JSON.stringify(record.mock.calls)).not.toContain("opaque-cart-token");
    await expect(new ReconcileShopifyPayment(new ReadShopifyReference(reader), { link }, { record }, false, { find: async () => null }, reader).execute(event)).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    fetcher.mockResolvedValueOnce(response({ ...paidOrder, totalReceivedSet: bag("7999") }));
    await expect(useCase.execute(event)).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    fetcher.mockResolvedValueOnce(response({ ...paidOrder, transactions: paidOrder.transactions.map((transaction) => ({ ...transaction, test: false })) }));
    await expect(useCase.execute(event)).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    expect(link).toHaveBeenCalledTimes(1); expect(record).toHaveBeenCalledTimes(1);
  });
  it("checks authoritative pricing after settlement persistence and holds stale source pricing", async () => {
    const { reader, fetcher } = client(); fetcher.mockImplementation(async () => response(pricedOrder()));
    const event = { provider: "SHOPIFY" as const, providerAccountId: config.storeDomain, eventType: "shopify.order.changed", externalEventId: "verified-digest", externalObjectId: orderId,
      apiVersion: config.apiVersion, occurredAt: new Date(), payload: { id: orderId, objectType: "shopify_order_reference", total: 1 } };
    const link = vi.fn().mockResolvedValue({ purchaseIntentId: "intent", attemptId: "attempt", orderId });
    const record = vi.fn().mockResolvedValue({ outcome: "APPLIED", status: "CAPTURED", version: 1 });
    const useCase = new ReconcileShopifyPayment(new ReadShopifyReference(reader), { link }, { record }, true, { find: async () => null }, reader);
    expect(await useCase.execute(event)).toMatchObject({ status: "CAPTURED", pricing: { status: "MATCHED", totals: { total: 8000, tax: 727, taxesIncluded: true } } });
    record.mockResolvedValueOnce({ outcome: "DUPLICATE", status: "CAPTURED", version: 1 });
    expect(await useCase.execute(event)).toMatchObject({ outcome: "DUPLICATE", pricing: { status: "MATCHED" } });
    record.mockResolvedValueOnce({ outcome: "STALE", status: "REFUNDED", version: 2 });
    expect(await useCase.execute(event)).toMatchObject({ status: "REFUNDED", pricing: { status: "HELD", reason: "STALE_OBSERVATION" } });
    for (const overrides of [{ subtotalPriceSet: bag("1"), currentSubtotalPriceSet: bag("1") }, { estimatedTaxes: true }, { edited: true }, { totalTaxSet: null }]) {
      fetcher.mockResolvedValueOnce(response({ ...pricedOrder(), ...overrides }));
      expect(await useCase.execute(event)).toMatchObject({ status: "CAPTURED", pricing: { status: "HELD" } });
    }
    expect(record).toHaveBeenCalledTimes(7);
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/opaque-cart-token|taxesIncluded/);
    record.mockRejectedValueOnce(new Error("persistence unavailable"));
    await expect(useCase.execute(event)).rejects.toThrow("persistence unavailable");
    const requestBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(requestBody.query).toContain("discountAllocations");
    expect(requestBody.query).toContain("currentShippingPriceSet");
    expect(requestBody.query).toContain("taxesIncluded");
  });
  it("preserves settlement facts while refusing incomplete, invalid or foreign-currency pricing", async () => {
    const complete = pricedOrder();
    for (const overrides of [
      { subtotalPriceSet: null }, { taxesIncluded: undefined }, { totalTaxSet: bag("0.1") },
      { currentShippingPriceSet: { shopMoney: { amount: "0", currencyCode: "USD" }, presentmentMoney: { amount: "0", currencyCode: "USD" } } },
      { originalTotalDutiesSet: undefined }, { currentTotalAdditionalFeesSet: undefined },
      { shippingLines: { ...complete.shippingLines, pageInfo: { hasNextPage: true } } },
      { shippingLines: { ...complete.shippingLines, nodes: Array.from({ length: 101 }, () => complete.shippingLines.nodes[0]) } },
      { lineItems: { ...complete.lineItems, nodes: complete.lineItems.nodes.map((line) => ({ ...line, discountAllocations: Array.from({ length: 101 }, () => ({ allocatedAmountSet: bag("1") })) })) } },
    ]) {
      const result = await client(response({ ...complete, ...overrides })).reader.read(reference);
      expect(result.order.pricing).toBeNull();
      expect(result.order.received.amount).toBe(8000);
      expect(result.order.transactions).toHaveLength(1);
    }
    const result = await client(response({ ...refund(), order: complete })).reader.read({ ...reference, kind: "REFUND", id: refundId });
    expect(result.order.pricing).toMatchObject({ tax: 727, total: 8000, duties: 0, additionalFees: 0 });
  });
  it("rechecks persisted delivery timing on retries and never trusts the notification's date", async () => {
    const { reader, fetcher } = client(); fetcher.mockImplementation(async () => response(pricedOrder()));
    const event = { provider: "SHOPIFY" as const, providerAccountId: config.storeDomain, eventType: "shopify.order.changed", externalEventId: "verified-digest", externalObjectId: orderId,
      apiVersion: config.apiVersion, occurredAt: new Date("2026-09-10T00:00:00Z"), payload: { id: orderId, objectType: "shopify_order_reference", deliveryDate: "2026-12-01" } };
    const linked = { purchaseIntentId: "intent", attemptId: "attempt", orderId };
    const plan = { deliveryDate: "2026-09-14", status: "CHECKOUT_CREATED", detailsAvailable: true, retentionExpiresAt: new Date("2026-10-11T00:00:00Z") };
    const find = vi.fn().mockResolvedValue(plan);
    const link = vi.fn().mockResolvedValue(linked);
    const record = vi.fn().mockResolvedValue({ outcome: "APPLIED", status: "CAPTURED", version: 1 });
    const now = vi.fn(() => new Date("2026-09-11T14:59:59.999Z"));
    const useCase = new ReconcileShopifyPayment(new ReadShopifyReference(reader), { link }, { record }, true, { find }, reader, now);
    expect(await useCase.execute(event)).toMatchObject({ deliveryTiming: { status: "WITHIN_WINDOW", deliveryDate: "2026-09-14" } });
    expect(find).toHaveBeenCalledWith(linked, config.storeDomain);
    record.mockResolvedValue({ outcome: "DUPLICATE", status: "CAPTURED", version: 1 });
    // Cross midnight during the database lookup; the workflow must use the clock after the read.
    find.mockImplementationOnce(async () => { now.mockReturnValue(new Date("2026-09-11T15:00:00Z")); return plan; });
    expect(await useCase.execute(event)).toMatchObject({ outcome: "DUPLICATE", deliveryTiming: { status: "HELD", reason: "INSUFFICIENT_LEAD_TIME" } });
    expect(record).toHaveBeenCalledTimes(2);
    now.mockReturnValue(new Date("2026-09-11T00:00:00Z"));
    for (const [override, reason] of [
      [{ deliveryDate: "2026-02-30" }, "INVALID_DELIVERY_DATE"],
      [{ retentionExpiresAt: new Date("2026-09-11T00:00:00Z") }, "PURCHASE_DETAILS_UNAVAILABLE"],
      [{ detailsAvailable: false }, "PURCHASE_DETAILS_UNAVAILABLE"],
      [{ status: "CONVERTED" }, "PURCHASE_ALREADY_CONVERTED"],
      [{ status: "EXPIRED" }, "PURCHASE_INACTIVE"],
      [{ status: "ABANDONED" }, "PURCHASE_INACTIVE"],
    ] as const) {
      find.mockResolvedValueOnce({ ...plan, ...override });
      expect(await useCase.execute(event)).toMatchObject({ deliveryTiming: { status: "HELD", reason } });
    }
    find.mockResolvedValueOnce(null);
    expect(await useCase.execute(event)).toMatchObject({ deliveryTiming: { status: "HELD", reason: "DELIVERY_PLAN_MISSING" } });
    find.mockRejectedValueOnce(new Error("plan read unavailable"));
    await expect(useCase.execute(event)).rejects.toThrow("plan read unavailable");
    expect(await useCase.execute(event)).toMatchObject({ outcome: "DUPLICATE", deliveryTiming: { status: "WITHIN_WINDOW" } });
    find.mockClear(); record.mockRejectedValueOnce(new Error("payment save unavailable"));
    await expect(useCase.execute(event)).rejects.toThrow("payment save unavailable");
    expect(find).not.toHaveBeenCalled();
  });
  it("holds cancelled, unsettled, pending-refund, stale and unpriced payments before reading a delivery plan", async () => {
    const complete = pricedOrder();
    const { reader, fetcher } = client();
    const event = { provider: "SHOPIFY" as const, providerAccountId: config.storeDomain, eventType: "shopify.order.changed", externalEventId: "verified-digest", externalObjectId: orderId,
      apiVersion: config.apiVersion, occurredAt: new Date(), payload: { id: orderId, objectType: "shopify_order_reference" } };
    const record = vi.fn(); const find = vi.fn();
    const useCase = new ReconcileShopifyPayment(new ReadShopifyReference(reader), { link: async () => ({ purchaseIntentId: "intent", attemptId: "attempt", orderId }) }, { record }, true, { find }, reader);
    const pendingRefund = { id: "gid://shopify/OrderTransaction/62", kind: "REFUND", status: "PENDING", test: true, parentTransaction: { id: complete.transactions[0].id }, amountSet: bag("500") };
    for (const scenario of [
      { source: { ...complete, cancelledAt: "2026-09-11T10:01:00Z" }, status: "CAPTURED", outcome: "APPLIED", reason: "ORDER_CANCELLED" },
      { source: { ...complete, transactions: [], totalReceivedSet: bag("0") }, status: "PROCESSING", outcome: "APPLIED", reason: "PAYMENT_NOT_SETTLED" },
      { source: { ...complete, transactions: [...complete.transactions, { ...pendingRefund, status: "SUCCESS" }], totalRefundedSet: bag("500") }, status: "PARTIALLY_REFUNDED", outcome: "APPLIED", reason: "PAYMENT_NOT_SETTLED" },
      { source: { ...complete, transactions: [...complete.transactions, pendingRefund] }, status: "CAPTURED", outcome: "APPLIED", reason: "PAYMENT_PENDING" },
      { source: complete, status: "REFUNDED", outcome: "STALE", reason: "STALE_OBSERVATION" },
      { source: { ...complete, totalTaxSet: null }, status: "CAPTURED", outcome: "APPLIED", reason: "PRICING_UNRESOLVED" },
    ]) {
      fetcher.mockResolvedValueOnce(response(scenario.source));
      record.mockResolvedValueOnce({ outcome: scenario.outcome, status: scenario.status, version: 1 });
      expect(await useCase.execute(event)).toMatchObject({ deliveryTiming: { status: "HELD", reason: scenario.reason } });
    }
    expect(record).toHaveBeenCalledTimes(6); expect(find).not.toHaveBeenCalled();
  });
  it("does not fetch protected addresses until coverage is approved", async () => {
    const { reader, fetcher } = client();
    expect(await reader.assessDestination(destinationReference)).toEqual({ status: "HELD", reason: "COVERAGE_NOT_APPROVED" });
    expect(fetcher).not.toHaveBeenCalled();
    const invalid = new ShopifyAdminOrderReader(config, fetcher, { approval: "APPROVED", prefectures: [], excludedPostalPrefixes: [] });
    expect(await invalid.assessDestination(destinationReference)).toEqual({ status: "HELD", reason: "COVERAGE_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses province codes and discards every protected address field at the provider boundary", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(destinationOrder()));
    const reader = new ShopifyAdminOrderReader(config, fetcher, approvedCoverage);
    for (const provinceCode of ["JP-01", "JP-13", "JP-47"]) {
      fetcher.mockResolvedValueOnce(response({ ...destinationOrder(), shippingAddress: { ...destinationOrder().shippingAddress, provinceCode } }));
      expect(await reader.assessDestination(destinationReference)).toEqual({ status: "STRUCTURALLY_VALID_AND_COVERED" });
    }
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.query).toContain("shippingAddress"); expect(body.query).toContain("provinceCode");
    expect(body.query).not.toMatch(/billingAddress|customer|email|phone|address2|formatted|latitude|longitude|cartToken/);
    expect(body.variables).toEqual({ id: orderId });
  });
  it.each([
    { orderId: "gid://shopify/Order/0" }, { shop: "other.myshopify.com" }, { updatedAt: "bad-date" },
  ])("rejects unsafe destination references before I/O %j", async (overrides) => {
    const fetcher = vi.fn<typeof fetch>(); const reader = new ShopifyAdminOrderReader(config, fetcher, approvedCoverage);
    await expect(reader.assessDestination({ ...destinationReference, ...overrides })).rejects.toBeInstanceOf(InvalidShopifyReferenceError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("holds address deficiencies, changed order versions and non-shipping orders without returning PII", async () => {
    const original = destinationOrder();
    const fetcher = vi.fn<typeof fetch>(); const reader = new ShopifyAdminOrderReader(config, fetcher, approvedCoverage);
    for (const [overrides, reason] of [
      [{ shippingAddress: null }, "ADDRESS_MISSING"],
      [{ shippingAddress: { ...original.shippingAddress, name: "" } }, "ADDRESS_INCOMPLETE"],
      [{ shippingAddress: { ...original.shippingAddress, provinceCode: "JP-48" } }, "PREFECTURE_UNRECOGNIZED"],
      [{ shippingAddress: { ...original.shippingAddress, zip: "１００－２１０１" } }, "REGION_EXCLUDED"],
      [{ shippingAddress: { ...original.shippingAddress, countryCodeV2: "US" } }, "COUNTRY_UNSUPPORTED"],
      [{ updatedAt: "2026-09-11T10:00:01Z" }, "ORDER_CHANGED"],
      [{ cancelledAt: "2026-09-11T10:00:00Z" }, "ORDER_CHANGED"],
      [{ requiresShipping: false }, "SHIPPING_NOT_REQUIRED"],
    ] as const) {
      fetcher.mockResolvedValueOnce(response({ ...original, ...overrides }));
      expect(await reader.assessDestination(destinationReference)).toEqual({ status: "HELD", reason });
    }
  });
  it("sanitizes protected-data denial, transport failures and scope/version/malformed responses", async () => {
    const original = destinationOrder();
    const fetcher = vi.fn<typeof fetch>(); const reader = new ShopifyAdminOrderReader(config, fetcher, approvedCoverage);
    for (const result of [response(null), response(original, { errors: [{ message: "宛名の秘密" }] }),
      response(original, { status: 403 }), response(original, { status: 429 }), response(original, { version: "2026-04" }),
      response(original, { shop: "other.myshopify.com" }), response({ ...original, id: "gid://shopify/Order/2" }),
      response({ ...original, test: false }), response({ ...original, shippingAddress: undefined }),
      response({ ...original, shippingAddress: { ...original.shippingAddress, name: "秘密".repeat(256) } }),
    ]) {
      fetcher.mockResolvedValueOnce(result);
      await expect(reader.assessDestination(destinationReference)).rejects.toEqual(new ShopifyDeliveryDestinationUnavailableError());
    }
    fetcher.mockRejectedValueOnce(new Error("宛名の秘密"));
    await expect(reader.assessDestination(destinationReference)).rejects.toEqual(new ShopifyDeliveryDestinationUnavailableError());
  });
  it("persists payment before the separate address read and rechecks timing after protected-data I/O", async () => {
    const event = { provider: "SHOPIFY" as const, providerAccountId: config.storeDomain, eventType: "shopify.order.changed", externalEventId: "verified-digest", externalObjectId: orderId,
      apiVersion: config.apiVersion, occurredAt: new Date(), payload: { id: orderId, objectType: "shopify_order_reference", shippingAddress: { countryCodeV2: "US" } } };
    const record = vi.fn().mockResolvedValue({ outcome: "APPLIED", status: "CAPTURED", version: 1 });
    const fetcher = vi.fn<typeof fetch>();
    const reader = new ShopifyAdminOrderReader(config, fetcher, approvedCoverage);
    const find = vi.fn().mockResolvedValue({ deliveryDate: "2026-09-14", status: "CHECKOUT_CREATED", detailsAvailable: true, retentionExpiresAt: new Date("2026-10-11T00:00:00Z") });
    const now = vi.fn(() => new Date("2026-09-11T14:59:59Z"));
    const useCase = new ReconcileShopifyPayment(new ReadShopifyReference(reader), { link: async () => ({ purchaseIntentId: "intent", attemptId: "attempt", orderId }) }, { record }, true, { find }, reader, now);
    fetcher.mockResolvedValueOnce(response(pricedOrder())).mockImplementationOnce(async () => {
      expect(record).toHaveBeenCalledTimes(1);
      return response(destinationOrder(), { errors: [{ message: "protected-data denied" }] });
    });
    await expect(useCase.execute(event)).rejects.toEqual(new ShopifyDeliveryDestinationUnavailableError());
    record.mockResolvedValue({ outcome: "DUPLICATE", status: "CAPTURED", version: 1 });
    fetcher.mockResolvedValueOnce(response(pricedOrder())).mockResolvedValueOnce(response(destinationOrder()));
    const result = await useCase.execute(event);
    expect(result).toMatchObject({ outcome: "DUPLICATE", destination: { status: "STRUCTURALLY_VALID_AND_COVERED" } });
    expect(JSON.stringify(result)).not.toMatch(/秘密|100-0001|JP-13|shippingAddress/);
    fetcher.mockResolvedValueOnce(response(pricedOrder())).mockImplementationOnce(async () => {
      now.mockReturnValue(new Date("2026-09-11T15:00:00Z")); return response(destinationOrder());
    });
    expect(await useCase.execute(event)).toMatchObject({ deliveryTiming: { status: "HELD", reason: "INSUFFICIENT_LEAD_TIME" },
      destination: { status: "HELD", reason: "PREREQUISITES_UNRESOLVED" } });
    expect(record).toHaveBeenCalledTimes(3);
    record.mockRejectedValueOnce(new Error("payment persistence unavailable"));
    fetcher.mockResolvedValueOnce(response(pricedOrder()));
    await expect(useCase.execute(event)).rejects.toThrow("payment persistence unavailable");
    expect(fetcher).toHaveBeenCalledTimes(7);
  });
  it("rejects a truncated or duplicate order transaction list", async () => {
    const transaction = { id: "gid://shopify/OrderTransaction/71", kind: "SALE", status: "SUCCESS", test: true, parentTransaction: null, amountSet: bag("8000") };
    for (const transactions of [[transaction, transaction], Array.from({ length: 101 }, (_, index) => ({ ...transaction, id: `gid://shopify/OrderTransaction/${index + 1}` }))]) {
      await expect(client(response({ ...order(), transactions })).reader.read(reference)).rejects.toBeInstanceOf(ShopifyOrderUnavailableError);
    }
  });
  it("reads the current order for a delayed signed notification and rejects a different provider", async () => {
    const secret = "isolated-webhook-secret";
    const raw = Buffer.from(JSON.stringify({ admin_graphql_api_id: orderId, updated_at: "2026-09-10T00:00:00Z" }));
    const event = new ShopifyWebhookVerifier({ storeDomain: config.storeDomain, webhookSecret: secret, apiVersion: config.apiVersion }).verify(raw, {
      signature: createHmac("sha256", secret).update(raw).digest("base64"), shop: config.storeDomain, topic: "orders/paid", apiVersion: config.apiVersion,
    })!;
    const { reader, fetcher } = client();
    fetcher.mockImplementation(async () => response({ ...order(), displayFinancialStatus: "REFUNDED" }));
    const useCase = new ReadShopifyReference(reader);
    expect((await useCase.execute(event)).order.financialStatus).toBe("REFUNDED");
    for (const overrides of [{ provider: "STRIPE" as const }, { eventType: "orders/paid" }, { externalObjectId: "gid://shopify/Order/2" }, { payload: {} }]) {
      await expect(useCase.execute({ ...event, ...overrides })).rejects.toBeInstanceOf(InvalidShopifyReferenceError);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    const link = vi.fn().mockResolvedValue({ purchaseIntentId: "local-intent", attemptId: "local-attempt", orderId });
    const association = new AssociateShopifyOrder(useCase, { link });
    const linked = await association.execute({ ...event, payload: { ...event.payload, cartToken: "forged-browser-token" } });
    expect(link).toHaveBeenCalledWith(expect.objectContaining({ shop: config.storeDomain, orderId, cartToken: "opaque-cart-token" }));
    expect(JSON.stringify(linked)).not.toContain("opaque-cart-token");
    link.mockRejectedValueOnce(new Error("unresolved association"));
    await expect(association.execute(event)).rejects.toThrow("unresolved association");
    fetcher.mockResolvedValueOnce(response(null));
    await expect(association.execute(event)).rejects.toBeInstanceOf(ShopifyOrderNotFoundError);
    expect(link).toHaveBeenCalledTimes(2);
  });
});
