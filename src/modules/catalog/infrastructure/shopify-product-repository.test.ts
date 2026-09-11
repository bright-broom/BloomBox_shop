import { afterEach, describe, expect, it, vi } from "vitest";
import { productId } from "../domain/product";
import type { ShopifyStorefrontConfig } from "@/shared/infrastructure/config/shopify-storefront-config";
import {
  ShopifyProductRepository,
} from "./shopify-product-repository";
import {
  ShopifyCatalogResponseError,
  ShopifyStorefrontFetchClient,
  SHOPIFY_RESPONSE_MAX_BYTES,
  SHOPIFY_REQUEST_TIMEOUT_MS,
  type ShopifyStorefrontClient,
} from "./shopify-storefront-client";

describe("ShopifyProductRepository", () => {
  it("paginates the curated tag and returns only available single-variant products", async () => {
    const request = vi.fn<ShopifyStorefrontClient["request"]>()
      .mockResolvedValueOnce(productsResponse([
        productNode({ handle: "sold-out", variantId: "101", available: false }),
      ], true, "cursor-1"))
      .mockResolvedValueOnce(productsResponse([
        productNode({ handle: "haru-no-hikari", variantId: "102" }),
      ], false, null));
    const repository = new ShopifyProductRepository({ request }, "bloombox");

    const products = await repository.findAvailable();

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      slug: "haru-no-hikari",
      externalReference: "gid://shopify/ProductVariant/102",
      price: { amount: 6600, currency: "JPY" },
      available: true,
    });
    expect(products[0].id).toMatch(/^shopify_[A-Za-z0-9_-]+$/);
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("BloomBoxProducts"),
      { first: 50, after: "cursor-1", query: "tag:bloombox" },
    );
  });

  it("resolves a public product ID back to the exact Shopify variant", async () => {
    const listedNode = productNode({ handle: "haru-no-hikari", variantId: "102" });
    const request = vi.fn<ShopifyStorefrontClient["request"]>()
      .mockResolvedValueOnce(productsResponse([listedNode], false, null));
    const repository = new ShopifyProductRepository({ request }, "bloombox");
    const [listed] = await repository.findAvailable();
    const { variants } = listedNode;
    request.mockResolvedValueOnce({
      data: { node: { ...variants.nodes[0], product: listedNode } },
    });

    await expect(repository.findById(listed.id)).resolves.toEqual(listed);
    expect(request).toHaveBeenLastCalledWith(
      expect.stringContaining("BloomBoxVariantById"),
      { id: "gid://shopify/ProductVariant/102" },
    );
  });

  it("rejects a second variant added after the product was listed", async () => {
    const product = productNode();
    const request = vi.fn<ShopifyStorefrontClient["request"]>()
      .mockResolvedValueOnce(productsResponse([product], false, null));
    const repository = new ShopifyProductRepository({ request }, "bloombox");
    const [listed] = await repository.findAvailable();
    product.variants.nodes.push({ ...product.variants.nodes[0], id: "gid://shopify/ProductVariant/999" });
    request.mockResolvedValueOnce({ data: { node: { ...product.variants.nodes[0], product } } });
    await expect(repository.findById(listed.id)).rejects.toBeInstanceOf(ShopifyCatalogResponseError);
  });

  it("rejects a response for a different requested variant", async () => {
    const product = productNode();
    const request = vi.fn<ShopifyStorefrontClient["request"]>()
      .mockResolvedValueOnce(productsResponse([product], false, null));
    const repository = new ShopifyProductRepository({ request }, "bloombox");
    const [listed] = await repository.findAvailable();
    const otherProduct = productNode({ variantId: "999" });
    request.mockResolvedValueOnce({ data: { node: { ...otherProduct.variants.nodes[0], product: otherProduct } } });
    await expect(repository.findById(listed.id)).rejects.toBeInstanceOf(ShopifyCatalogResponseError);
  });

  it.each(["", " ", "0x10", "6.6e3", "6600.01", "-1", "Infinity", "9007199254740992"])("rejects invalid JPY amount %j", async (amount) => {
    const product = productNode();
    product.variants.nodes[0].price.amount = amount;
    const repository = new ShopifyProductRepository({
      request: vi.fn().mockResolvedValue(productsResponse([product], false, null)),
    }, "bloombox");
    await expect(repository.findAvailable()).rejects.toBeInstanceOf(ShopifyCatalogResponseError);
  });

  it("rejects a root variant that does not match its parent's sole variant", async () => {
    const product = productNode();
    const request = vi.fn<ShopifyStorefrontClient["request"]>()
      .mockResolvedValueOnce(productsResponse([product], false, null));
    const repository = new ShopifyProductRepository({ request }, "bloombox");
    const [listed] = await repository.findAvailable();
    request.mockResolvedValueOnce({ data: { node: {
      id: product.variants.nodes[0].id, product: productNode({ variantId: "999" }),
    } } });
    await expect(repository.findById(listed.id)).rejects.toBeInstanceOf(ShopifyCatalogResponseError);
  });

  it("re-reads changed price and sold-out state by ID, without preview shipping metadata", async () => {
    const product = productNode();
    const request = vi.fn<ShopifyStorefrontClient["request"]>()
      .mockResolvedValueOnce(productsResponse([product], false, null));
    const repository = new ShopifyProductRepository({ request }, "bloombox");
    const [listed] = await repository.findAvailable();
    product.variants.nodes[0].price.amount = "8000.00";
    product.variants.nodes[0].availableForSale = false;
    request.mockResolvedValueOnce({ data: { node: { id: product.variants.nodes[0].id, product } } });
    const refreshed = await repository.findById(listed.id);
    expect(refreshed).toMatchObject({ price: { amount: 8000, currency: "JPY" }, available: false });
    expect(refreshed?.previewOffer).toBeUndefined();
  });

  it("rejects noncanonical aliases for an opaque ID before calling Shopify", async () => {
    const canonicalId = `shopify_${Buffer.from("gid://shopify/ProductVariant/101").toString("base64url")}`;
    const request = vi.fn<ShopifyStorefrontClient["request"]>();
    const repository = new ShopifyProductRepository({ request }, "bloombox");
    await expect(repository.findById(productId(`${canonicalId}!`))).resolves.toBeNull();
    await expect(repository.findById(productId(`${canonicalId}=`))).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a response for a different product handle", async () => {
    const request = vi.fn<ShopifyStorefrontClient["request"]>().mockResolvedValue({
      data: { product: productNode({ handle: "other-flower" }) },
    });
    await expect(new ShopifyProductRepository({ request }, "bloombox")
      .findBySlug("haru-no-hikari")).rejects.toBeInstanceOf(ShopifyCatalogResponseError);
  });

  it("returns null for products outside the curated catalog", async () => {
    const request = vi.fn<ShopifyStorefrontClient["request"]>().mockResolvedValue({
      data: { product: productNode({ tags: ["other"] }) },
    });

    await expect(new ShopifyProductRepository({ request }, "bloombox")
      .findBySlug("haru-no-hikari")).resolves.toBeNull();
  });

  it("fails closed for ambiguous variants or non-JPY prices", async () => {
    const ambiguous = productNode();
    ambiguous.variants.nodes.push({
      ...ambiguous.variants.nodes[0],
      id: "gid://shopify/ProductVariant/999",
    });
    const ambiguousRepository = new ShopifyProductRepository({
      request: vi.fn().mockResolvedValue(productsResponse([ambiguous], false, null)),
    }, "bloombox");
    const wrongCurrency = productNode();
    wrongCurrency.variants.nodes[0].price.currencyCode = "USD";
    const wrongCurrencyRepository = new ShopifyProductRepository({
      request: vi.fn().mockResolvedValue(productsResponse([wrongCurrency], false, null)),
    }, "bloombox");

    await expect(ambiguousRepository.findAvailable()).rejects
      .toBeInstanceOf(ShopifyCatalogResponseError);
    await expect(wrongCurrencyRepository.findAvailable()).rejects
      .toBeInstanceOf(ShopifyCatalogResponseError);
  });
});

describe("ShopifyStorefrontFetchClient", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts a valid multibyte response exactly at the byte limit", async () => {
    const content = JSON.stringify({ text: "花".repeat(Math.floor((SHOPIFY_RESPONSE_MAX_BYTES - 11) / 3)) });
    const body = content + " ".repeat(SHOPIFY_RESPONSE_MAX_BYTES - Buffer.byteLength(content));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      headers: { "x-shopify-api-version": "2026-07" },
    }));
    const client = new ShopifyStorefrontFetchClient(config(), { fetchImplementation });
    await expect(client.request("query { shop { name } }", {})).resolves.toEqual(JSON.parse(content));
    expect(fetchImplementation.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
  });

  it("does not retry malformed JSON or expose its content", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret-response", {
      headers: { "x-shopify-api-version": "2026-07" },
    }));
    const client = new ShopifyStorefrontFetchClient(config(), { fetchImplementation, delay: vi.fn() });
    await expect(client.request("query { shop { name } }", {})).rejects.toThrow("Shopify catalog response is invalid");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("discards unauthorized responses without retry", async () => {
    const response = new Response("private-error", { status: 401 });
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response);
    const client = new ShopifyStorefrontFetchClient(config(), { fetchImplementation, delay: vi.fn() });
    await expect(client.request("query { shop { name } }", {})).rejects.toBeInstanceOf(ShopifyCatalogResponseError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(true);
  });

  it("stops after three unavailable responses and cancels each body", async () => {
    const responses: Response[] = [];
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async () => {
      const response = new Response("private-provider-error", { status: 503 });
      responses.push(response);
      return response;
    });
    const delay = vi.fn().mockResolvedValue(undefined);
    const client = new ShopifyStorefrontFetchClient(config(), { fetchImplementation, delay });
    await expect(client.request("query { shop { name } }", {})).rejects.toBeInstanceOf(ShopifyCatalogResponseError);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenNthCalledWith(1, 100);
    expect(delay).toHaveBeenNthCalledWith(2, 200);
    expect(responses.every((response) => response.bodyUsed)).toBe(true);
  });

  it("keeps the timeout active during body reads and stops after three attempts", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Expected request deadline");
      signals.push(signal);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(new Error("private-transport-details")), { once: true });
        },
      }), { headers: { "x-shopify-api-version": "2026-07" } });
    });
    const client = new ShopifyStorefrontFetchClient(config(), { fetchImplementation, delay: async () => undefined });
    const result = expect(client.request("query { shop { name } }", {}))
      .rejects.toThrow("Shopify catalog response is invalid");
    await vi.advanceTimersByTimeAsync(SHOPIFY_REQUEST_TIMEOUT_MS * 3);
    await result;
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, "2026-04"])("rejects missing or different API version %j without retry", async (version) => {
    const response = Response.json({ data: {} }, { headers: version ? { "x-shopify-api-version": version } : {} });
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response);
    const client = new ShopifyStorefrontFetchClient(config(), { fetchImplementation, delay: vi.fn() });
    await expect(client.request("query { shop { name } }", {})).rejects.toBeInstanceOf(ShopifyCatalogResponseError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(true);
  });

  it("cancels an oversized chunked body before reading the remainder and does not retry", async () => {
    let reads = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(SHOPIFY_RESPONSE_MAX_BYTES + 1));
        if (reads === 4) controller.close();
      },
      cancel,
    }, { highWaterMark: 0 });
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
      headers: { "x-shopify-api-version": "2026-07" },
    }));
    const client = new ShopifyStorefrontFetchClient(config(), { fetchImplementation, delay: vi.fn() });
    await expect(client.request("query { shop { name } }", {})).rejects.toBeInstanceOf(ShopifyCatalogResponseError);
    expect(reads).toBe(1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("uses the pinned HTTPS endpoint and retries a throttled read without leaking the token", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("throttled", {
        status: 429,
        headers: { "retry-after": "0" },
      }))
      .mockResolvedValueOnce(Response.json({ data: { shop: { name: "BloomBox" } } }, { headers: { "x-shopify-api-version": "2026-07" } }));
    const delay = vi.fn().mockResolvedValue(undefined);
    const client = new ShopifyStorefrontFetchClient(
      config(),
      {
        fetchImplementation,
        delay,
        buyerIp: async () => "203.0.113.10",
      },
    );

    await expect(client.request("query Shop { shop { name } }", {}))
      .resolves.toEqual({ data: { shop: { name: "BloomBox" } } });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(fetchImplementation.mock.calls[0][0]).toBe(
      "https://example-shop.myshopify.com/api/2026-07/graphql.json",
    );
    const init = fetchImplementation.mock.calls[0][1];
    expect(init?.headers).toMatchObject({
      "X-Shopify-Storefront-Access-Token": "storefront-token-example",
      "Shopify-Storefront-Buyer-IP": "203.0.113.10",
    });
    expect(init?.body).not.toContain("storefront-token-example");
    expect(delay).toHaveBeenCalledWith(0);
  });

  it("retries a retryable GraphQL 200 error", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      }, { headers: { "x-shopify-api-version": "2026-07" } }))
      .mockResolvedValueOnce(Response.json({ data: { shop: { name: "BloomBox" } } }, { headers: { "x-shopify-api-version": "2026-07" } }));
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(new ShopifyStorefrontFetchClient(
      config(),
      { fetchImplementation, delay },
    ).request("query Shop { shop { name } }", {})).resolves.toEqual({
      data: { shop: { name: "BloomBox" } },
    });
    expect(delay).toHaveBeenCalledWith(1_000);
  });
});

function config(): ShopifyStorefrontConfig {
  return {
    storeDomain: "example-shop.myshopify.com",
    accessToken: "storefront-token-example",
    catalogTag: "bloombox",
    apiVersion: "2026-07",
  };
}

function productsResponse(
  nodes: ReturnType<typeof productNode>[],
  hasNextPage: boolean,
  endCursor: string | null,
) {
  return { data: { products: { nodes, pageInfo: { hasNextPage, endCursor } } } };
}

function productNode(input: {
  handle?: string;
  variantId?: string;
  available?: boolean;
  tags?: string[];
} = {}) {
  const available = input.available ?? true;
  return {
    title: "春のひかり",
    handle: input.handle ?? "haru-no-hikari",
    description: "朝の光のように軽やかなブーケです。",
    availableForSale: available,
    tags: input.tags ?? ["bloombox"],
    featuredImage: {
      url: "https://cdn.shopify.com/s/files/1/0000/0001/products/haru.jpg",
      altText: "ピンクの花束",
    },
    subtitle: { value: "やわらかな光を束ねたブーケ", type: "single_line_text_field" },
    palette: { value: "Tulip · Blush · Leaf", type: "single_line_text_field" },
    occasion: { value: '["誕生日","お祝い"]', type: "list.single_line_text_field" },
    flowers: { value: '["チューリップ","季節のグリーン"]', type: "list.single_line_text_field" },
    grower: { value: "南房総・花人 佐藤農園", type: "single_line_text_field" },
    variants: {
      nodes: [{
        id: `gid://shopify/ProductVariant/${input.variantId ?? "101"}`,
        availableForSale: available,
        price: { amount: "6600.0", currencyCode: "JPY" },
      }],
    },
  };
}
