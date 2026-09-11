import { z } from "zod";
import { shopifyFulfillmentFactSchema } from "./shopify-fulfillment-observation-schema";
const gid = (kind: string) => z.string().max(100).regex(new RegExp(`^gid://shopify/${kind}/[1-9]\\d*$`));
const quantity = z.number().int().positive().max(2_147_483_647);
const uniqueIds = <T extends { id: string }>(items: T[]) => new Set(items.map((item) => item.id)).size === items.length;
export const shopifyFulfillmentQuantitiesSchema = z.object({
  updatedAt: z.iso.datetime({ offset: true }),
  lines: z.array(z.object({ id: gid("LineItem"), variantId: gid("ProductVariant").nullable(), quantity,
    currentQuantity: z.number().int().nonnegative().max(2_147_483_647),
  })).min(1).max(100).refine(uniqueIds).transform((lines) => lines.sort((a, b) => a.id.localeCompare(b.id))),
  fulfillments: z.array(shopifyFulfillmentFactSchema.extend({
    lines: z.array(z.object({ id: gid("FulfillmentLineItem"), lineItemId: gid("LineItem"), quantity }))
      .min(1).max(100).refine(uniqueIds).transform((lines) => lines.sort((a, b) => a.id.localeCompare(b.id))),
  })).max(100).refine(uniqueIds).transform((items) => items.sort((a, b) => a.id.localeCompare(b.id))),
}).refine((source) => {
  const ids = source.fulfillments.flatMap((item) => item.lines.map((line) => line.id));
  return new Set(ids).size === ids.length;
});
export const acceptedFulfillmentItemsSchema = z.array(z.object({ variantId: gid("ProductVariant"), quantity })).min(1).max(100);

export const fulfillmentQuantityAssessmentSchema = z.object({
  status: z.enum(["UNVERIFIED", "NONE", "PARTIALLY_SHIPPED", "SHIPPED", "PARTIALLY_DELIVERED", "DELIVERED", "REVIEW_REQUIRED"]),
  reason: z.enum(["SOURCE_UNAVAILABLE", "ORDER_ITEMS_CHANGED", "UNKNOWN_ORDER_LINE", "QUANTITY_EXCEEDED", "AMBIGUOUS_FULFILLMENT", "SOURCE_REGRESSION", "SOURCE_CONFLICT", "MATCHED"]),
  ordered: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  shipped: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(), delivered: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
});
