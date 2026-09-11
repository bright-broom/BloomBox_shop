import { describe, expect, it, vi } from "vitest";
import { ShopifyAdminOrderReader } from "./shopify-admin-order-reader";
import { ShopifyFulfillmentStockUnavailableError } from "@/modules/fulfillment/public";
const config = { storeDomain: "stock-test.myshopify.com", accessToken: "synthetic-admin-token", apiVersion: "2026-07" } as const;
const reference = { shop: config.storeDomain, orderId: "gid://shopify/Order/1", test: true };
const inventoryId = "gid://shopify/InventoryItem/1"; const locationId = "gid://shopify/Location/1";
const updatedAt = "2026-09-11T10:00:00Z";
function plan() { return { __typename: "Order", id: reference.orderId, test: true, updatedAt,
  fulfillmentOrders: { pageInfo: { hasNextPage: false }, nodes: [{ id: "gid://shopify/FulfillmentOrder/1", orderId: reference.orderId, updatedAt,
    status: "OPEN", requestStatus: "UNSUBMITTED", supportedActions: [{ action: "CREATE_FULFILLMENT" }],
    assignedLocation: { location: { id: locationId, isActive: true } }, lineItems: { pageInfo: { hasNextPage: false }, nodes: [{
      id: "gid://shopify/FulfillmentOrderLineItem/1", inventoryItemId: inventoryId, variant: { id: "gid://shopify/ProductVariant/1", inventoryItem: { id: inventoryId } },
      totalQuantity: 1, remainingQuantity: 1, requiresShipping: true,
    }] } }] } }; }
function stock() { return { __typename: "InventoryItem", id: inventoryId, tracked: true,
  inventoryLevel: { item: { id: inventoryId }, location: { id: locationId }, isActive: true, updatedAt,
    quantities: [{ name: "available", quantity: 0 }, { name: "committed", quantity: 1 }, { name: "on_hand", quantity: 1 }] } }; }
function fixture(node: unknown = plan(), item: unknown = stock()) {
  const response = (value: unknown, shop = config.storeDomain) => Response.json({ data: { shop: { myshopifyDomain: shop }, node: value } }, { headers: { "x-shopify-api-version": config.apiVersion } });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => response(JSON.parse(String(init?.body)).query.includes("BloomBoxAllocatedStock") ? item : node));
  return { reader: new ShopifyAdminOrderReader(config, fetcher), fetcher, response };
}
describe("Shopify allocated stock provider read", () => {
  it("reads only assigned inventory/location pairs and confirms allocation stability without requesting PII", async () => {
    const { reader, fetcher } = fixture({ ...plan(), destination: "PRIVATE" }, { ...stock(), inventoryHistoryUrl: "PRIVATE" });
    const result = await reader.readFulfillmentStock(reference);
    expect(result).toMatchObject({ ...reference, allocations: [{ locationId, canCreateFulfillment: true }],
      stocks: [{ inventoryItemId: inventoryId, locationId, available: 0, committed: 1, onHand: 1 }] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(fetcher).toHaveBeenCalledTimes(3);
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body.variables).toEqual({ id: inventoryId, locationId });
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe(`https://${config.storeDomain}/admin/api/2026-07/graphql.json`);
      expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
      expect(JSON.parse(String(init?.body)).query).not.toMatch(/mutation|address|phone|tracking|destination|sku|unitCost/);
    }
  });
  it.each(["page", "line-page", "foreign-order", "wrong-inventory", "duplicate", "live"])("rejects an incomplete/unscoped allocation: %s", async (fault) => {
    const value = plan(); const allocation = value.fulfillmentOrders.nodes[0]; const line = allocation.lineItems.nodes[0];
    const node = { ...value, test: fault !== "live", fulfillmentOrders: {
      pageInfo: { hasNextPage: fault === "page" }, nodes: [{ ...allocation, orderId: fault === "foreign-order" ? "gid://shopify/Order/2" : reference.orderId,
        lineItems: { pageInfo: { hasNextPage: fault === "line-page" }, nodes: fault === "duplicate" ? [line, line]
          : [{ ...line, inventoryItemId: fault === "wrong-inventory" ? "gid://shopify/InventoryItem/2" : inventoryId }] } }],
    } };
    const { reader, fetcher } = fixture(node);
    await expect(reader.readFulfillmentStock(reference)).rejects.toEqual(new ShopifyFulfillmentStockUnavailableError());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["location", "inventory", "quantity-missing", "quantity-duplicate"])("rejects mismatched stock or incomplete quantities: %s", async (fault) => {
    const item = stock(); const level = item.inventoryLevel;
    const node = { ...item, id: fault === "inventory" ? "gid://shopify/InventoryItem/2" : inventoryId,
      inventoryLevel: { ...level, location: { id: fault === "location" ? "gid://shopify/Location/2" : locationId },
        quantities: fault === "quantity-missing" ? level.quantities.slice(1) : fault === "quantity-duplicate" ? [level.quantities[0], level.quantities[0], level.quantities[2]] : level.quantities } };
    await expect(fixture(plan(), node).reader.readFulfillmentStock(reference)).rejects.toEqual(new ShopifyFulfillmentStockUnavailableError());
  });
  it("detects allocation changes between the stock read and final confirmation", async () => {
    const { reader, fetcher, response } = fixture();
    fetcher.mockResolvedValueOnce(response(plan())).mockResolvedValueOnce(response(stock())).mockResolvedValueOnce(response({ ...plan(), updatedAt: "2026-09-11T11:00:00Z" }));
    await expect(reader.readFulfillmentStock(reference)).rejects.toEqual(new ShopifyFulfillmentStockUnavailableError());
  });
  it("returns missing levels as unavailable facts and fails safely for transport errors or invalid input", async () => {
    expect(await fixture(plan(), { ...stock(), inventoryLevel: null }).reader.readFulfillmentStock(reference)).toMatchObject({ stocks: [{ active: false, available: null }] });
    const { reader, fetcher } = fixture();
    await expect(reader.readFulfillmentStock({ ...reference, shop: "other.myshopify.com" })).rejects.toEqual(new ShopifyFulfillmentStockUnavailableError());
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValue(new Error("PRIVATE"));
    await expect(reader.readFulfillmentStock(reference)).rejects.toEqual(new ShopifyFulfillmentStockUnavailableError());
  });
});
