import { describe, expect, it, vi } from "vitest";
import type { ShopifyStorefrontConfig } from "@/shared/infrastructure/config/shopify-storefront-config";
import {
  ShopifyProductRepository,
} from "./shopify-product-repository";
import {
  ShopifyCatalogResponseError,
  ShopifyStorefrontFetchClient,
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
    const { variants, ...product } = listedNode;
    request.mockResolvedValueOnce({
      data: { node: { ...variants.nodes[0], product } },
    });

    await expect(repository.findById(listed.id)).resolves.toEqual(listed);
    expect(request).toHaveBeenLastCalledWith(
      expect.stringContaining("BloomBoxVariantById"),
      { id: "gid://shopify/ProductVariant/102" },
    );
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
  it("uses the pinned HTTPS endpoint and retries a throttled read without leaking the token", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("throttled", {
        status: 429,
        headers: { "retry-after": "0" },
      }))
      .mockResolvedValueOnce(Response.json({ data: { shop: { name: "BloomBox" } } }));
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
      }))
      .mockResolvedValueOnce(Response.json({ data: { shop: { name: "BloomBox" } } }));
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
