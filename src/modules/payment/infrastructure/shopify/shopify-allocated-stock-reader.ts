import { z } from "zod";
import { parseShopifyFulfillmentStockSnapshot, ShopifyFulfillmentStockUnavailableError, type ShopifyFulfillmentStockReader } from "@/modules/fulfillment/public";
const gid = (kind: string) => z.string().max(100).regex(new RegExp(`^gid://shopify/${kind}/[1-9]\\d*$`));
const date = z.iso.datetime({ offset: true }); const code = z.string().regex(/^[A-Z_]{1,50}$/);
const quantity = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const envelopeSchema = z.object({ errors: z.array(z.unknown()).length(0).optional(), data: z.object({ shop: z.object({ myshopifyDomain: z.string() }), node: z.unknown() }) });
const planSchema = z.object({ __typename: z.literal("Order"), id: gid("Order"), test: z.boolean(), updatedAt: date,
  fulfillmentOrders: z.object({ pageInfo: z.object({ hasNextPage: z.literal(false) }), nodes: z.array(z.object({
    id: gid("FulfillmentOrder"), orderId: gid("Order"), updatedAt: date, status: code, requestStatus: code,
    supportedActions: z.array(z.object({ action: code })).max(20),
    assignedLocation: z.object({ location: z.object({ id: gid("Location"), isActive: z.boolean() }).nullable() }),
    lineItems: z.object({ pageInfo: z.object({ hasNextPage: z.literal(false) }), nodes: z.array(z.object({
      id: gid("FulfillmentOrderLineItem"), inventoryItemId: gid("InventoryItem").nullable(),
      variant: z.object({ id: gid("ProductVariant"), inventoryItem: z.object({ id: gid("InventoryItem") }) }).nullable(),
      totalQuantity: quantity.nonnegative(), remainingQuantity: quantity.nonnegative(), requiresShipping: z.boolean(),
    }).refine((line) => !line.variant || line.inventoryItemId === line.variant.inventoryItem.id)).max(10) }),
  })).max(5) }),
}).refine((order) => order.fulfillmentOrders.nodes.every((item) => item.orderId === order.id));
const stockSchema = z.object({ __typename: z.literal("InventoryItem"), id: gid("InventoryItem"), tracked: z.boolean(),
  inventoryLevel: z.object({ item: z.object({ id: gid("InventoryItem") }), location: z.object({ id: gid("Location") }), isActive: z.boolean(), updatedAt: date,
    quantities: z.array(z.object({ name: z.enum(["available", "committed", "on_hand"]), quantity })).length(3)
      .refine((values) => new Set(values.map((value) => value.name)).size === 3),
  }).nullable(),
});
const PLAN_QUERY = `query BloomBoxFulfillmentAllocation($id: ID!) {
  shop { myshopifyDomain } node(id: $id) { __typename ... on Order { id test updatedAt
    fulfillmentOrders(first: 5) { pageInfo { hasNextPage } nodes {
      id orderId updatedAt status requestStatus supportedActions { action } assignedLocation { location { id isActive } }
      lineItems(first: 10) { pageInfo { hasNextPage } nodes { id inventoryItemId variant { id inventoryItem { id } } totalQuantity remainingQuantity requiresShipping } }
    } }
  } }
}`;
const STOCK_QUERY = `query BloomBoxAllocatedStock($id: ID!, $locationId: ID!) {
  shop { myshopifyDomain } node(id: $id) { __typename ... on InventoryItem { id tracked
    inventoryLevel(locationId: $locationId) { item { id } location { id } isActive updatedAt quantities(names: ["available", "committed", "on_hand"]) { name quantity } }
  } }
}`;
/** Uses the existing fixed-origin, version-pinned bounded transport; never obtains credentials or writes stock. */
export class ShopifyAllocatedStockReader implements ShopifyFulfillmentStockReader {
  constructor(private readonly shop: string, private readonly request: (id: string, query: string, locationId?: string) => Promise<unknown>, private readonly now: () => Date = () => new Date()) {}
  async readFulfillmentStock(reference: Readonly<{ shop: string; orderId: string; test: boolean }>) {
    try {
      if (reference.shop !== this.shop || !gid("Order").safeParse(reference.orderId).success || typeof reference.test !== "boolean") throw new ShopifyFulfillmentStockUnavailableError();
      const readPlan = async () => {
        const envelope = envelopeSchema.parse(await this.request(reference.orderId, PLAN_QUERY));
        const order = planSchema.parse(envelope.data.node);
        if (envelope.data.shop.myshopifyDomain !== this.shop || order.id !== reference.orderId || order.test !== reference.test) throw new ShopifyFulfillmentStockUnavailableError();
        return parseShopifyFulfillmentStockSnapshot({ ...reference, checkedAt: this.now().toISOString(), orderUpdatedAt: order.updatedAt, stocks: [],
          allocations: order.fulfillmentOrders.nodes.map((item) => ({ id: item.id, updatedAt: item.updatedAt, status: item.status, requestStatus: item.requestStatus,
            canCreateFulfillment: item.supportedActions.some((action) => action.action === "CREATE_FULFILLMENT"),
            locationId: item.assignedLocation.location?.id ?? null, locationActive: item.assignedLocation.location?.isActive ?? false,
            lines: item.lineItems.nodes.map((line) => ({ id: line.id, variantId: line.variant?.id ?? null, inventoryItemId: line.inventoryItemId,
              quantity: line.totalQuantity, remainingQuantity: line.remainingQuantity, requiresShipping: line.requiresShipping })),
          })) });
      };
      const plan = await readPlan();
      const pairs = new Map<string, { inventoryItemId: string; locationId: string }>();
      for (const allocation of plan.allocations) {
        for (const line of allocation.lines) {
          if (allocation.locationId && allocation.locationActive && line.inventoryItemId) {
            pairs.set(`${allocation.locationId}:${line.inventoryItemId}`, { inventoryItemId: line.inventoryItemId, locationId: allocation.locationId });
          }
        }
      }
      if (pairs.size > 10) throw new ShopifyFulfillmentStockUnavailableError();
      const stocks = await Promise.all([...pairs.values()].map(async (pair) => {
        const envelope = envelopeSchema.parse(await this.request(pair.inventoryItemId, STOCK_QUERY, pair.locationId));
        const item = stockSchema.parse(envelope.data.node); const level = item.inventoryLevel;
        if (envelope.data.shop.myshopifyDomain !== this.shop || item.id !== pair.inventoryItemId
          || (level && (level.item.id !== pair.inventoryItemId || level.location.id !== pair.locationId))) throw new ShopifyFulfillmentStockUnavailableError();
        return { ...pair, tracked: item.tracked, active: level?.isActive ?? false, updatedAt: level?.updatedAt ?? null,
          available: level?.quantities.find((value) => value.name === "available")?.quantity ?? null,
          committed: level?.quantities.find((value) => value.name === "committed")?.quantity ?? null,
          onHand: level?.quantities.find((value) => value.name === "on_hand")?.quantity ?? null };
      }));
      const confirmed = await readPlan();
      if (confirmed.orderUpdatedAt !== plan.orderUpdatedAt || JSON.stringify(confirmed.allocations) !== JSON.stringify(plan.allocations)) throw new ShopifyFulfillmentStockUnavailableError();
      return parseShopifyFulfillmentStockSnapshot({ ...confirmed, checkedAt: plan.checkedAt, stocks });
    } catch { throw new ShopifyFulfillmentStockUnavailableError(); }
  }
}
