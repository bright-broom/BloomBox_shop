import { describe, expect, it } from "vitest";
import { shopifyCartIdentityFromId, shopifyCartTokenDigest } from "./shopify-cart-identity";
import { ShopifyCheckoutConflictError } from "../../application/shopify-checkout-attempt";
describe("Shopify opaque cart identity", () => {
  it.each(["opaque_Ab-12", "Z2NwLXVzOmFiYw==", "future/format:%41", "花-token"])("compares the literal token without guessing its format: %s", (token) => {
    expect(shopifyCartIdentityFromId(`gid://shopify/Cart/${token}?key=private`)).toBe(shopifyCartTokenDigest(token));
    expect(shopifyCartIdentityFromId(`gid://shopify/Cart/${token}?key=rotated`)).toBe(shopifyCartTokenDigest(token));
    expect(shopifyCartTokenDigest(token)).not.toContain(token);
  });
  it("does not equate normalized, decoded or trimmed tokens", () => {
    expect(shopifyCartTokenDigest("%41")).not.toBe(shopifyCartTokenDigest("A"));
    expect(shopifyCartTokenDigest("Abc")).not.toBe(shopifyCartTokenDigest("abc"));
    expect(shopifyCartTokenDigest("token ")).not.toBe(shopifyCartTokenDigest("token"));
  });
  it.each(["gid://shopify/Cart/a", "gid://shopify/Cart/?key=x", "gid://shopify/Order/1?key=x", "gid://shopify/Cart/a?key=x&key=y", "gid://shopify/Cart/a?key=", "gid://shopify/Cart/a?key=x#fragment"])("rejects malformed cart credentials", (id) => {
    expect(() => shopifyCartIdentityFromId(id)).toThrow(ShopifyCheckoutConflictError);
  });
  it("bounds token bytes before hashing", () => {
    expect(() => shopifyCartTokenDigest("花".repeat(50_000))).toThrow(ShopifyCheckoutConflictError);
    expect(() => shopifyCartTokenDigest("")).toThrow(ShopifyCheckoutConflictError);
  });
});
