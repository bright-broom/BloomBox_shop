import { money } from "@/shared/domain/money";
import { SHOPIFY_PRODUCT_IMAGE_HOST } from "@/shared/infrastructure/config/shopify-storefront-config";
import { z } from "zod";
import type { ProductRepository } from "../domain/product-repository";
import { productId, type Product, type ProductId } from "../domain/product";
import {
  ShopifyCatalogResponseError,
  type ShopifyStorefrontClient,
} from "./shopify-storefront-client";

export const SHOPIFY_CATALOG_PAGE_SIZE = 50;
export const SHOPIFY_CATALOG_MAX_PAGES = 20;

const gidPattern = /^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]*$/;
const metafieldSchema = z.object({ value: z.string(), type: z.string() }).nullable();
const variantSchema = z.object({
  id: z.string().regex(gidPattern),
  availableForSale: z.boolean(),
  price: z.object({ amount: z.string(), currencyCode: z.literal("JPY") }),
});
const productNodeSchema = z.object({
  title: z.string().trim().min(1).max(80),
  handle: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().min(1).max(2_000),
  availableForSale: z.boolean(),
  tags: z.array(z.string()),
  featuredImage: z.object({
    url: z.string().url(),
    altText: z.string().trim().min(1).max(200).nullable(),
  }).nullable(),
  subtitle: metafieldSchema,
  palette: metafieldSchema,
  occasion: metafieldSchema,
  flowers: metafieldSchema,
  grower: metafieldSchema,
  variants: z.object({ nodes: z.array(variantSchema).min(1).max(2) }),
});

const productsResponseSchema = graphqlResponseSchema(z.object({
  products: z.object({
    nodes: z.array(productNodeSchema),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }),
}));
const productResponseSchema = graphqlResponseSchema(z.object({
  product: productNodeSchema.nullable(),
}));
const variantResponseSchema = graphqlResponseSchema(z.object({
  node: variantSchema.extend({ product: productNodeSchema.omit({ variants: true }) }).nullable(),
}));

const PRODUCT_FIELDS_FRAGMENT = `
  fragment BloomBoxProduct on Product {
    title
    handle
    description
    availableForSale
    tags
    featuredImage { url altText }
    subtitle: metafield(namespace: "bloombox", key: "subtitle") { value type }
    palette: metafield(namespace: "bloombox", key: "palette") { value type }
    occasion: metafield(namespace: "bloombox", key: "occasion") { value type }
    flowers: metafield(namespace: "bloombox", key: "flowers") { value type }
    grower: metafield(namespace: "bloombox", key: "grower") { value type }
    variants(first: 2) { nodes { id availableForSale price { amount currencyCode } } }
  }
`;

const PRODUCTS_QUERY = `#graphql
  query BloomBoxProducts($first: Int!, $after: String, $query: String!) @inContext(country: JP, language: JA) {
    products(first: $first, after: $after, query: $query, sortKey: TITLE) {
      nodes { ...BloomBoxProduct }
      pageInfo { hasNextPage endCursor }
    }
  }
  ${PRODUCT_FIELDS_FRAGMENT}
`;

const PRODUCT_BY_HANDLE_QUERY = `#graphql
  query BloomBoxProductByHandle($handle: String!) @inContext(country: JP, language: JA) {
    product(handle: $handle) { ...BloomBoxProduct }
  }
  ${PRODUCT_FIELDS_FRAGMENT}
`;

const VARIANT_BY_ID_QUERY = `#graphql
  query BloomBoxVariantById($id: ID!) @inContext(country: JP, language: JA) {
    node(id: $id) {
      ... on ProductVariant {
        id
        availableForSale
        price { amount currencyCode }
        product { ...BloomBoxProduct }
      }
    }
  }
  ${PRODUCT_FIELDS_FRAGMENT}
`;

export class ShopifyProductRepository implements ProductRepository {
  constructor(
    private readonly client: ShopifyStorefrontClient,
    private readonly catalogTag: string,
  ) {}

  async findAvailable(): Promise<readonly Product[]> {
    const products: Product[] = [];
    let after: string | null = null;

    for (let page = 0; page < SHOPIFY_CATALOG_MAX_PAGES; page += 1) {
      const response: z.infer<typeof productsResponseSchema>["data"] = parseResponse(
        productsResponseSchema,
        await this.client.request(
          PRODUCTS_QUERY,
          { first: SHOPIFY_CATALOG_PAGE_SIZE, after, query: `tag:${this.catalogTag}` },
        ),
      );
      products.push(...response.products.nodes.map((node) => this.mapProduct(node)));
      if (!response.products.pageInfo.hasNextPage) return uniqueProducts(products)
        .filter((product) => product.available);
      after = response.products.pageInfo.endCursor;
      if (!after) throw new ShopifyCatalogResponseError();
    }
    throw new ShopifyCatalogResponseError();
  }

  async findBySlug(slug: string): Promise<Product | null> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
    const response = parseResponse(productResponseSchema, await this.client.request(
      PRODUCT_BY_HANDLE_QUERY,
      { handle: slug },
    ));
    if (!response.product || !response.product.tags.includes(this.catalogTag)) return null;
    return this.mapProduct(response.product);
  }

  async findById(id: ProductId): Promise<Product | null> {
    const externalId = decodeProductId(id);
    if (!externalId) return null;
    const response = parseResponse(variantResponseSchema, await this.client.request(
      VARIANT_BY_ID_QUERY,
      { id: externalId },
    ));
    if (!response.node || !response.node.product.tags.includes(this.catalogTag)) return null;
    return mapProductNode(response.node.product, response.node);
  }

  private mapProduct(node: z.infer<typeof productNodeSchema>): Product {
    if (!node.tags.includes(this.catalogTag) || node.variants.nodes.length !== 1) {
      throw new ShopifyCatalogResponseError();
    }
    return mapProductNode(node, node.variants.nodes[0]);
  }
}

function mapProductNode(
  node: z.infer<typeof productNodeSchema> | NonNullable<
    z.infer<typeof variantResponseSchema>["data"]["node"]
  >["product"],
  variant: z.infer<typeof variantSchema>,
): Product {
  if (!node.featuredImage) throw new ShopifyCatalogResponseError();
  const imageUrl = new URL(node.featuredImage.url);
  if (imageUrl.protocol !== "https:" || imageUrl.hostname !== SHOPIFY_PRODUCT_IMAGE_HOST) {
    throw new ShopifyCatalogResponseError();
  }
  const amount = Number(variant.price.amount);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ShopifyCatalogResponseError();
  return {
    id: encodeProductId(variant.id),
    externalReference: variant.id,
    slug: node.handle,
    name: node.title,
    subtitle: requiredTextMetafield(node.subtitle),
    description: node.description,
    price: money(amount),
    imageUrl: node.featuredImage.url,
    imageAlt: node.featuredImage.altText ?? node.title,
    palette: requiredTextMetafield(node.palette),
    occasion: requiredListMetafield(node.occasion),
    flowers: requiredListMetafield(node.flowers),
    grower: requiredTextMetafield(node.grower),
    available: node.availableForSale && variant.availableForSale,
  };
}

function requiredTextMetafield(value: z.infer<typeof metafieldSchema>): string {
  const normalized = value?.value.trim();
  if (!normalized || value?.type !== "single_line_text_field") {
    throw new ShopifyCatalogResponseError();
  }
  return normalized;
}

function requiredListMetafield(value: z.infer<typeof metafieldSchema>): readonly string[] {
  try {
    if (value?.type !== "list.single_line_text_field") throw new ShopifyCatalogResponseError();
    const parsed = z.array(z.string().trim().min(1)).min(1).parse(JSON.parse(value?.value ?? ""));
    return parsed;
  } catch {
    throw new ShopifyCatalogResponseError();
  }
}

function encodeProductId(externalId: string): ProductId {
  return productId(`shopify_${Buffer.from(externalId, "utf8").toString("base64url")}`);
}

function decodeProductId(id: ProductId): string | null {
  if (!id.startsWith("shopify_")) return null;
  try {
    const decoded = Buffer.from(id.slice("shopify_".length), "base64url").toString("utf8");
    return gidPattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function uniqueProducts(products: readonly Product[]): readonly Product[] {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const product of products) {
    if (ids.has(product.id) || slugs.has(product.slug)) throw new ShopifyCatalogResponseError();
    ids.add(product.id);
    slugs.add(product.slug);
  }
  return products;
}

function graphqlResponseSchema<T extends z.ZodType>(data: T) {
  return z.object({
    data,
    errors: z.array(z.object({ message: z.string() })).optional(),
  });
}

function parseResponse<T>(
  schema: z.ZodType<{ data: T; errors?: readonly { message: string }[] }>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data.errors?.length) throw new ShopifyCatalogResponseError();
  return parsed.data.data;
}
