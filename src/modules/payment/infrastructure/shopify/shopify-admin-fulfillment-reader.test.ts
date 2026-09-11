import { describe, expect, it, vi } from "vitest";
import { ShopifyFulfillmentUnavailableError } from "@/modules/fulfillment/public";
import { ShopifyAdminOrderReader } from "./shopify-admin-order-reader";
const config = { storeDomain: "bloom-test.myshopify.com", accessToken: "synthetic-admin-token", apiVersion: "2026-07" } as const;
const reference = { shop: config.storeDomain, orderId: "gid://shopify/Order/9007199254740993", test: true };
const fact = { id: "gid://shopify/Fulfillment/9007199254740995", status: "SUCCESS", updatedAt: "2026-09-11T12:00:00Z",
  inTransitAt: "2026-09-11T10:00:00Z", deliveredAt: null, order: { id: reference.orderId } };
function order() { return { __typename: "Order", id: reference.orderId, test: true,
  fulfillmentsCount: { count: 1, precision: "EXACT" }, fulfillments: [fact] }; }
function client(node: unknown, options: { shop?: string; errors?: unknown[]; version?: string; status?: number } = {}) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    data: { shop: { myshopifyDomain: options.shop ?? config.storeDomain }, node }, errors: options.errors ?? [],
  }, { status: options.status ?? 200, headers: { "x-shopify-api-version": options.version ?? config.apiVersion } }));
  return { reader: new ShopifyAdminOrderReader(config, fetcher), fetcher };
}
function quantityOrder() {
  return { ...order(), updatedAt: fact.updatedAt,
    lineItems: { nodes: [{ id: "gid://shopify/LineItem/1", quantity: 1, currentQuantity: 1, variant: { id: "gid://shopify/ProductVariant/1" } }], pageInfo: { hasNextPage: false } },
    fulfillments: [{ ...fact, totalQuantity: 1, fulfillmentLineItems: {
      nodes: [{ id: "gid://shopify/FulfillmentLineItem/1", quantity: 1, lineItem: { id: "gid://shopify/LineItem/1" } }], pageInfo: { hasNextPage: false } } }],
  };
}
describe("Shopify authoritative fulfillment read", () => {
  it("reads a complete bounded array without requesting or returning tracking or recipient data", async () => {
    const { reader, fetcher } = client({ ...order(), fulfillments: [{ ...fact, trackingInfo: [{ number: "PRIVATE" }] }], shippingAddress: "PRIVATE" });
    expect(await reader.readFulfillments(reference)).toEqual({ ...reference, quantities: null,
      fulfillments: [{ id: fact.id, status: fact.status, updatedAt: fact.updatedAt, inTransitAt: fact.inTransitAt, deliveredAt: null }] });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`https://${config.storeDomain}/admin/api/2026-07/graphql.json`);
    expect(init).toMatchObject({ cache: "no-store", redirect: "error", method: "POST" });
    const body = JSON.parse(String(init?.body));
    expect(body.variables).toEqual({ id: reference.orderId });
    expect(body.query).toContain("fulfillments(first: 11)");
    expect(body.query).toContain("fulfillmentsCount { count precision }");
    expect(body.query).not.toMatch(/tracking|Address|phone|email|mutation/);
  });
  it("returns complete order and split-fulfillment quantities with source timestamps", async () => {
    const { reader, fetcher } = client(quantityOrder());
    expect(await reader.readFulfillments(reference)).toMatchObject({ quantities: { updatedAt: fact.updatedAt,
      lines: [{ id: "gid://shopify/LineItem/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1, currentQuantity: 1 }],
      fulfillments: [{ id: fact.id, lines: [{ id: "gid://shopify/FulfillmentLineItem/1", lineItemId: "gid://shopify/LineItem/1", quantity: 1 }] }] } });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).query).toContain("fulfillmentLineItems(first: 20)");
  });
  it.each(["order-page", "shipment-page", "null-quantity", "total-mismatch", "duplicate-lines"])("retains activity but marks incomplete quantities unavailable: %s", async (fault) => {
    const node = quantityOrder(); const shipment = node.fulfillments[0];
    const invalid = fault === "order-page" ? { ...node, lineItems: { ...node.lineItems, pageInfo: { hasNextPage: true } } }
      : { ...node, fulfillments: [{ ...shipment,
        totalQuantity: fault === "total-mismatch" ? 2 : shipment.totalQuantity,
        fulfillmentLineItems: { nodes: fault === "null-quantity" ? [{ ...shipment.fulfillmentLineItems.nodes[0], quantity: null }]
          : fault === "duplicate-lines" ? [...shipment.fulfillmentLineItems.nodes, ...shipment.fulfillmentLineItems.nodes] : shipment.fulfillmentLineItems.nodes,
          pageInfo: { hasNextPage: fault === "shipment-page" } } }] };
    const result = await client(invalid).reader.readFulfillments(reference);
    expect(result.quantities).toBeNull();
    expect(result.fulfillments).toMatchObject([{ id: fact.id, inTransitAt: fact.inTransitAt }]);
  });
  it("recognizes zero records only when the exact count agrees", async () => {
    expect(await client({ ...order(), fulfillmentsCount: { count: 0, precision: "EXACT" }, fulfillments: [] }).reader.readFulfillments(reference))
      .toMatchObject({ fulfillments: [] });
  });
  it.each([
    null, { ...order(), test: false }, { ...order(), id: "gid://shopify/Order/2" },
    { ...order(), fulfillmentsCount: null }, { ...order(), fulfillmentsCount: { count: 1, precision: "AT_LEAST" } },
    { ...order(), fulfillmentsCount: { count: 2, precision: "EXACT" } },
    { ...order(), fulfillmentsCount: { count: 101, precision: "EXACT" }, fulfillments: Array(101).fill(fact) },
    { ...order(), fulfillmentsCount: { count: 2, precision: "EXACT" }, fulfillments: [fact, fact] },
    { ...order(), fulfillments: [{ ...fact, status: "UNKNOWN" }] },
    { ...order(), fulfillments: [{ ...fact, inTransitAt: "invalid" }] },
    { ...order(), fulfillments: [{ ...fact, order: { id: "gid://shopify/Order/2" } }] },
    { ...order(), fulfillments: [{ ...fact, id: "gid://shopify/Refund/1" }] },
  ])("rejects missing, partial, unscoped or malformed evidence %#", async (node) => {
    await expect(client(node).reader.readFulfillments(reference)).rejects.toEqual(new ShopifyFulfillmentUnavailableError());
  });
  it.each([{ shop: "other.myshopify.com" }, { errors: [{ message: "PRIVATE" }] }, { version: "2026-10" }, { status: 429 }])("fails safely for provider envelope %j", async (options) => {
    await expect(client(order(), options).reader.readFulfillments(reference)).rejects.toEqual(new ShopifyFulfillmentUnavailableError());
  });
  it("rejects an invalid scope before sending credentials and sanitizes transport failures", async () => {
    const { reader, fetcher } = client(order());
    await expect(reader.readFulfillments({ ...reference, shop: "other.myshopify.com" })).rejects.toEqual(new ShopifyFulfillmentUnavailableError());
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValue(new Error("PRIVATE"));
    await expect(reader.readFulfillments(reference)).rejects.toEqual(new ShopifyFulfillmentUnavailableError());
  });
});
