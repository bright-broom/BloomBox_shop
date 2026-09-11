import { z } from "zod";
import { ShopifyFulfillmentStockUnavailableError } from "../application/read-shopify-fulfillment-stock";
const gid = (kind: string) => z.string().max(100).regex(new RegExp(`^gid://shopify/${kind}/[1-9]\\d*$`));
const date = z.iso.datetime({ offset: true });
const quantity = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const uniqueIds = <T extends { id: string }>(items: T[]) => new Set(items.map((item) => item.id)).size === items.length;
const schema = z.object({
  shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/), orderId: gid("Order"), test: z.boolean(), orderUpdatedAt: date, checkedAt: date,
  allocations: z.array(z.object({ id: gid("FulfillmentOrder"), updatedAt: date, status: z.string().regex(/^[A-Z_]{1,50}$/), requestStatus: z.string().regex(/^[A-Z_]{1,50}$/),
    canCreateFulfillment: z.boolean(), locationId: gid("Location").nullable(), locationActive: z.boolean(),
    lines: z.array(z.object({ id: gid("FulfillmentOrderLineItem"), variantId: gid("ProductVariant").nullable(), inventoryItemId: gid("InventoryItem").nullable(),
      quantity: quantity.nonnegative(), remainingQuantity: quantity.nonnegative(), requiresShipping: z.boolean(),
    })).max(10).refine(uniqueIds).transform((lines) => lines.sort((a, b) => a.id.localeCompare(b.id))),
  })).max(5).refine(uniqueIds).transform((items) => items.sort((a, b) => a.id.localeCompare(b.id))),
  stocks: z.array(z.object({ inventoryItemId: gid("InventoryItem"), locationId: gid("Location"), tracked: z.boolean(), active: z.boolean(),
    updatedAt: date.nullable(), available: quantity.nullable(), committed: quantity.nullable(), onHand: quantity.nullable(),
  })).max(10).refine((items) => new Set(items.map((item) => `${item.locationId}:${item.inventoryItemId}`)).size === items.length)
    .transform((items) => items.sort((a, b) => `${a.locationId}:${a.inventoryItemId}`.localeCompare(`${b.locationId}:${b.inventoryItemId}`))),
}).refine((source) => {
  const ids = source.allocations.flatMap((allocation) => allocation.lines.map((line) => line.id));
  return new Set(ids).size === ids.length;
});
export function parseShopifyFulfillmentStockSnapshot(value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ShopifyFulfillmentStockUnavailableError();
  return result.data;
}
export const fulfillmentStockAssessmentSchema = z.object({ status: z.enum(["UNVERIFIED", "HELD", "COVERED"]),
  reason: z.enum(["NOT_CONFIGURED", "STALE_SNAPSHOT", "ALLOCATION_BLOCKED", "ORDER_ITEMS_CHANGED", "STOCK_UNAVAILABLE", "STOCK_UNTRACKED",
    "STOCK_INCONSISTENT", "STOCK_SHORTAGE", "COMMITMENT_UNVERIFIED", "COMMITMENTS_COVERED"]),
});
