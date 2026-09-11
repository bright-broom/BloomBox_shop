/** Observed activity on any part of the order, never proof that the entire order shipped. */
export const SHOPIFY_FULFILLMENT_ACTIVITIES = ["UNVERIFIED", "NONE", "RECORDED", "IN_TRANSIT", "DELIVERED"] as const;
export type ShopifyFulfillmentActivity = typeof SHOPIFY_FULFILLMENT_ACTIVITIES[number];
export type ShopifyFulfillmentFact = Readonly<{
  id: string; status: "CANCELLED" | "ERROR" | "FAILURE" | "SUCCESS" | "OPEN" | "PENDING";
  updatedAt: string; inTransitAt: string | null; deliveredAt: string | null;
}>;
export type ShopifyFulfillmentObservation = Readonly<{
  activity: ShopifyFulfillmentActivity; witness: ShopifyFulfillmentFact | null;
}>;

/** A missing/older record cannot retract physical activity already observed. Manual resolution is separate. */
export function observeShopifyFulfillment(previous: ShopifyFulfillmentObservation, facts: readonly ShopifyFulfillmentFact[] | null): ShopifyFulfillmentObservation {
  let observation = previous;
  if (observation.activity === "UNVERIFIED" && facts !== null) observation = { activity: "NONE", witness: null };
  for (const fact of facts ?? []) {
    const activity = fact.deliveredAt ? "DELIVERED" : fact.inTransitAt ? "IN_TRANSIT" : "RECORDED";
    if (SHOPIFY_FULFILLMENT_ACTIVITIES.indexOf(activity) > SHOPIFY_FULFILLMENT_ACTIVITIES.indexOf(observation.activity)) {
      observation = { activity, witness: fact };
    }
  }
  return observation;
}
