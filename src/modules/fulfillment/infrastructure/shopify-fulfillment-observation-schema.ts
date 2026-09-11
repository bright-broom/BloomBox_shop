import { z } from "zod";
import { SHOPIFY_FULFILLMENT_ACTIVITIES } from "../domain/shopify-fulfillment-observation";
const date = z.iso.datetime({ offset: true });
export const shopifyFulfillmentFactSchema = z.object({
  id: z.string().max(100).regex(/^gid:\/\/shopify\/Fulfillment\/[1-9]\d*$/),
  status: z.enum(["CANCELLED", "ERROR", "FAILURE", "SUCCESS", "OPEN", "PENDING"]),
  updatedAt: date, inTransitAt: date.nullable(), deliveredAt: date.nullable(),
});
export const shopifyFulfillmentObservationSchema = z.object({
  activity: z.enum(SHOPIFY_FULFILLMENT_ACTIVITIES), witness: shopifyFulfillmentFactSchema.nullable(),
}).refine(({ activity, witness }) => activity === "UNVERIFIED" || activity === "NONE" ? witness === null
  : witness !== null && (activity === "DELIVERED" ? witness.deliveredAt !== null
    : activity === "IN_TRANSIT" ? witness.inTransitAt !== null && witness.deliveredAt === null
    : witness.inTransitAt === null && witness.deliveredAt === null));
export const shopifyFulfillmentSnapshotSchema = z.object({
  shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  orderId: z.string().max(100).regex(/^gid:\/\/shopify\/Order\/[1-9]\d*$/), test: z.boolean(),
  fulfillments: z.array(shopifyFulfillmentFactSchema).max(100)
    .refine((facts) => new Set(facts.map((fact) => fact.id)).size === facts.length),
});
