import { createHash } from "node:crypto";
import { ShopifyCheckoutConflictError } from "../../application/shopify-checkout-attempt";

/** Opaque identifiers: never decode base64, normalize, trim, or infer a Shopify token format. */
export function shopifyCartTokenDigest(token: string): string {
  if (typeof token !== "string" || !token || Buffer.byteLength(token, "utf8") > 128_000) {
    throw new ShopifyCheckoutConflictError();
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function shopifyCartIdentityFromId(cartId: string): string {
  const prefix = "gid://shopify/Cart/";
  const query = cartId.indexOf("?");
  if (!cartId.startsWith(prefix) || query <= prefix.length || cartId.includes("#")) throw new ShopifyCheckoutConflictError();
  const params = new URLSearchParams(cartId.slice(query + 1));
  if (params.getAll("key").length !== 1 || !params.get("key")) throw new ShopifyCheckoutConflictError();
  return shopifyCartTokenDigest(cartId.slice(prefix.length, query));
}
