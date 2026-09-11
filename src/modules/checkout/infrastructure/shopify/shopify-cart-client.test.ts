import { describe, expect, it, vi } from "vitest";
import { loadShopifyCheckoutConfig } from "@/shared/infrastructure/config/shopify-checkout-config";
import { money } from "@/shared/domain/money";
import { catalogProductReference, commerceProductReference, PurchaseIntent, purchaseIntentId } from "../../domain/purchase-intent";
import { giftMessage, recipientName } from "../../domain/purchase-intent-policy";
import {
  ShopifyCartClient, ShopifyCartCreationUncertainError, ShopifyCartInputError,
  ShopifyCartUnavailableError, SHOPIFY_CART_RESPONSE_MAX_BYTES, SHOPIFY_CART_TIMEOUT_MS,
} from "./shopify-cart-client";

const config = loadShopifyCheckoutConfig({
  SHOPIFY_STORE_DOMAIN: "bloombox-test.myshopify.com",
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: "isolated-storefront-test-token",
});
const intentId = "12345678-abcd-4000-8000-123456789012";
const cartId = "gid://shopify/Cart/test-cart?key=private-cart-capability";

function intent(quantity = 2, createdAt = new Date()): PurchaseIntent {
  const result = PurchaseIntent.create({
    id: purchaseIntentId(intentId), displayId: "BB-TEST",
    item: {
      productId: catalogProductReference("prod_haru_01"),
      externalProductReference: commerceProductReference("gid://shopify/ProductVariant/123"),
      productName: "春のひかり", quantity, unitPriceSnapshot: money(6600), subtotal: money(6600 * quantity),
    },
    recipient: { name: recipientName("花子"), deliveryDate: "2026-09-20" },
    giftMessage: giftMessage("おめでとう"), createdAt,
  });
  result.transitionTo("READY_FOR_CHECKOUT");
  return result;
}

function cart() {
  return {
    id: cartId, checkoutUrl: `https://${config.storeDomain}/checkouts/test-checkout`,
    attributes: [{ key: "bloombox_purchase_intent_id", value: intentId }],
    totalQuantity: 2,
    lines: {
      nodes: [{ quantity: 2, merchandise: { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/123" },
        cost: { amountPerQuantity: { amount: "6600.0", currencyCode: "JPY" },
          subtotalAmount: { amount: "13200.0", currencyCode: "JPY" } } }],
      pageInfo: { hasNextPage: false },
    },
  };
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: {
    "Content-Type": "application/json", "X-Shopify-API-Version": config.apiVersion,
  } });
}

describe("ShopifyCartClient (disabled handoff boundary)", () => {
  it("creates a Japanese cart using the server-owned variant and quantity without sending price or PII", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({
      data: { cartCreate: { cart: cart(), userErrors: [], warnings: [] } },
    }));
    const client = new ShopifyCartClient(config, fetcher);
    expect(await client.create(intent())).toEqual({
      cartId, checkoutUrl: cart().checkoutUrl, purchaseIntentId: intentId, apiVersion: "2026-07",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetcher.mock.calls[0];
    expect(endpoint).toBe(`https://${config.storeDomain}/api/2026-07/graphql.json`);
    expect(request).toMatchObject({ redirect: "error", cache: "no-store", headers: {
      "X-Shopify-Storefront-Access-Token": config.accessToken,
    } });
    const serialized = String(request?.body);
    const payload = JSON.parse(serialized);
    expect(payload.variables.input).toEqual({
      buyerIdentity: { countryCode: "JP" },
      lines: [{ merchandiseId: "gid://shopify/ProductVariant/123", quantity: 2 }],
      attributes: [{ key: "bloombox_purchase_intent_id", value: intentId }],
    });
    expect(serialized).not.toContain("花子");
    expect(serialized).not.toContain("おめでとう");
    expect(serialized).not.toContain("6600");
    expect(payload.query).toContain("@inContext(country: JP, language: JA)");
  });

  it("retrieves the existing cart on repeated reads without issuing another mutation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({ data: { cart: cart() } }));
    const client = new ShopifyCartClient(config, fetcher);
    await client.retrieve(cartId, intent());
    await client.retrieve(cartId, intent());
    for (const [, request] of fetcher.mock.calls) {
      expect(String(request?.body)).toContain("query BloomBoxCart");
      expect(String(request?.body)).not.toContain("mutation");
    }
  });

  it("preserves opaque cart tokens and encoded secret keys without assuming an encoding or fixed length", async () => {
    const opaqueId = `gid://shopify/Cart/region:${"long-token/".repeat(250)}?key=encoded%2Bsecret%3D`;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { cart: { ...cart(), id: opaqueId } } }));
    const result = await new ShopifyCartClient(config, fetcher).retrieve(opaqueId, intent());
    expect(result.cartId).toBe(opaqueId);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).variables.id).toBe(opaqueId);
  });

  it.each([0, 6])("rejects invalid quantity %s before any external request", async (quantity) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new ShopifyCartClient(config, fetcher).create(intent(quantity))).rejects.toThrow(ShopifyCartInputError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects duplicate creation for an already assigned intent and cart IDs without their secret", async () => {
    const existing = intent();
    existing.recordCheckoutCreated({ provider: "SHOPIFY", externalCheckoutId: cartId,
      providerApiVersion: "2026-07", occurredAt: new Date() });
    const fetcher = vi.fn<typeof fetch>();
    const client = new ShopifyCartClient(config, fetcher);
    await expect(client.create(existing)).rejects.toThrow(ShopifyCartInputError);
    await expect(client.retrieve("gid://shopify/Cart/test-cart", intent())).rejects.toThrow(ShopifyCartInputError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not create an external cart for an expired purchase intent", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const now = new Date("2026-09-12T00:00:00Z");
    const client = new ShopifyCartClient(config, fetcher, () => now);
    await expect(client.create(intent(2, new Date("2026-09-11T00:00:00Z"))))
      .rejects.toThrow(ShopifyCartInputError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([null, "2026-04"])("rejects a missing or silently changed API version: %s", async (apiVersion) => {
    const result = response({ data: { cart: cart() } });
    if (apiVersion) result.headers.set("X-Shopify-API-Version", apiVersion);
    else result.headers.delete("X-Shopify-API-Version");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(result);
    await expect(new ShopifyCartClient(config, fetcher).retrieve(cartId, intent())).rejects.toThrow(ShopifyCartUnavailableError);
  });

  it.each([
    ["changed price", (value: ReturnType<typeof cart>) => { value.lines.nodes[0].cost.amountPerQuantity.amount = "6700"; }],
    ["fractional JPY", (value: ReturnType<typeof cart>) => { value.lines.nodes[0].cost.subtotalAmount.amount = "13200.01"; }],
    ["unsafe integer", (value: ReturnType<typeof cart>) => { value.lines.nodes[0].cost.subtotalAmount.amount = "9007199254740993"; }],
    ["wrong currency", (value: ReturnType<typeof cart>) => { value.lines.nodes[0].cost.subtotalAmount.currencyCode = "USD"; }],
    ["adjusted quantity", (value: ReturnType<typeof cart>) => { value.lines.nodes[0].quantity = 1; }],
    ["different variant", (value: ReturnType<typeof cart>) => { value.lines.nodes[0].merchandise.id = "gid://shopify/ProductVariant/456"; }],
    ["different intent", (value: ReturnType<typeof cart>) => { value.attributes[0].value = "another-intent"; }],
    ["duplicate reference", (value: ReturnType<typeof cart>) => { value.attributes.push(value.attributes[0]); }],
    ["unexpected extra line", (value: ReturnType<typeof cart>) => { value.lines.nodes.push(value.lines.nodes[0]); }],
    ["hidden additional lines", (value: ReturnType<typeof cart>) => { value.lines.pageInfo.hasNextPage = true; }],
  ] as const)("refuses a handoff with %s", async (_label, change) => {
    const value = cart();
    change(value);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { cart: value } }));
    await expect(new ShopifyCartClient(config, fetcher).retrieve(cartId, intent()))
      .rejects.toThrow(ShopifyCartUnavailableError);
  });

  it.each([
    "https://attacker.test/pay", `https://${config.storeDomain}.attacker.test/pay`,
    `http://${config.storeDomain}/pay`, `https://user:secret@${config.storeDomain}/pay`,
    `https://${config.storeDomain}:444/pay`, `https://${config.storeDomain}/pay#secret`, "invalid URL",
  ])("rejects an unsafe checkout destination %s", async (checkoutUrl) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { cart: { ...cart(), checkoutUrl } } }));
    await expect(new ShopifyCartClient(config, fetcher).retrieve(cartId, intent()))
      .rejects.toThrow(ShopifyCartUnavailableError);
  });

  it.each([
    { data: { cart: null } }, { data: { cart: cart() }, errors: [{ message: "secret-provider-message" }] },
    { data: { cart: { ...cart(), id: "gid://shopify/Cart/other?key=other" } } },
  ])("rejects missing, partial, or mismatched retrieved carts", async (value) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value));
    await expect(new ShopifyCartClient(config, fetcher).retrieve(cartId, intent())).rejects.toThrow(ShopifyCartUnavailableError);
  });

  it.each([
    { data: { cartCreate: { cart: cart(), userErrors: [{ code: "INVALID" }], warnings: [] } } },
    { data: { cartCreate: { cart: cart(), userErrors: [], warnings: [{ code: "MERCHANDISE_NOT_ENOUGH_STOCK" }] } } },
    { data: { cartCreate: { cart: null, userErrors: [], warnings: [] } } },
  ])("does not retry a mutation or expose its URL after a partial creation response", async (value) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value));
    await expect(new ShopifyCartClient(config, fetcher).create(intent())).rejects.toThrow(ShopifyCartCreationUncertainError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500, 503])("does not retry cart creation after HTTP %s", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret-provider-message", { status }));
    await expect(new ShopifyCartClient(config, fetcher).create(intent())).rejects.toThrow(ShopifyCartCreationUncertainError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("redacts transport failures and never retries an ambiguous cart creation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`network failed ${config.accessToken} ${cartId}`));
    const error = await new ShopifyCartClient(config, fetcher).create(intent()).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ShopifyCartCreationUncertainError);
    expect(String(error)).not.toContain(config.accessToken);
    expect(String(error)).not.toContain(cartId);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds chunked response size and cancels oversized streams", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(SHOPIFY_CART_RESPONSE_MAX_BYTES + 1)); }, cancel,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      headers: { "X-Shopify-API-Version": config.apiVersion },
    }));
    await expect(new ShopifyCartClient(config, fetcher).retrieve(cartId, intent())).rejects.toThrow(ShopifyCartUnavailableError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("aborts stalled requests at the timeout without retrying creation", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
      const check = expect(new ShopifyCartClient(config, fetcher).create(intent())).rejects.toThrow(ShopifyCartCreationUncertainError);
      await vi.advanceTimersByTimeAsync(SHOPIFY_CART_TIMEOUT_MS);
      await check;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
