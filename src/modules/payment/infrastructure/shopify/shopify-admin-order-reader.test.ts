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
    const useCase = new ReconcileShopifyPayment(new ReadShopifyReference(reader), { link }, { record }, true);
    expect(await useCase.execute(event)).toMatchObject({ status: "PARTIALLY_REFUNDED" });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ orderId }), config.storeDomain, expect.objectContaining({ received: 8000, refunded: 500, transactions: expect.arrayContaining([expect.objectContaining({ kind: "REFUND", status: "SUCCEEDED", amount: 500 })]) }));
    expect(JSON.stringify(record.mock.calls)).not.toContain("opaque-cart-token");
    await expect(new ReconcileShopifyPayment(new ReadShopifyReference(reader), { link }, { record }, false).execute(event)).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    fetcher.mockResolvedValueOnce(response({ ...paidOrder, totalReceivedSet: bag("7999") }));
    await expect(useCase.execute(event)).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    fetcher.mockResolvedValueOnce(response({ ...paidOrder, transactions: paidOrder.transactions.map((transaction) => ({ ...transaction, test: false })) }));
    await expect(useCase.execute(event)).rejects.toBeInstanceOf(SettlementEvidenceConflictError);
    expect(link).toHaveBeenCalledTimes(1); expect(record).toHaveBeenCalledTimes(1);
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
