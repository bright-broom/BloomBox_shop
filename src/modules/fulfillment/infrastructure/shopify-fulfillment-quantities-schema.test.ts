import { describe, expect, it } from "vitest";
import { shopifyFulfillmentQuantitiesSchema } from "./shopify-fulfillment-quantities-schema";
const line = { id: "gid://shopify/LineItem/1", variantId: "gid://shopify/ProductVariant/1", quantity: 1, currentQuantity: 1 };
const fulfillmentLine = { id: "gid://shopify/FulfillmentLineItem/1", lineItemId: line.id, quantity: 1 };
const fulfillment = { id: "gid://shopify/Fulfillment/1", status: "SUCCESS", updatedAt: "2026-09-12T10:00:00Z", inTransitAt: null, deliveredAt: null, lines: [fulfillmentLine] };
const source = { updatedAt: fulfillment.updatedAt, lines: [line], fulfillments: [fulfillment] };
describe("Fulfillment quantity persistence boundary", () => {
  it.each([
    { ...source, lines: [line, line] }, { ...source, fulfillments: [fulfillment, fulfillment] },
    { ...source, fulfillments: [fulfillment, { ...fulfillment, id: "gid://shopify/Fulfillment/2" }] },
    { ...source, fulfillments: [{ ...fulfillment, lines: [{ ...fulfillmentLine, quantity: null }] }] },
    { ...source, fulfillments: [{ ...fulfillment, lines: [{ ...fulfillmentLine, quantity: 0 }] }] },
    { ...source, lines: [{ ...line, quantity: Number.MAX_SAFE_INTEGER }] },
  ])("rejects duplicate identities and invalid quantities %#", (value) => {
    expect(shopifyFulfillmentQuantitiesSchema.safeParse(value).success).toBe(false);
  });
  it("normalizes array order and strips fields unrelated to quantity evidence", () => {
    const second = { ...line, id: "gid://shopify/LineItem/2" };
    expect(shopifyFulfillmentQuantitiesSchema.parse({ ...source, lines: [second, line], shippingAddress: "private" }))
      .toEqual({ ...source, lines: [line, second] });
  });
});
