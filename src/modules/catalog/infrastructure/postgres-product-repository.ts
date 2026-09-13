import { MAX_PUBLISHED_CATALOG_PRODUCTS } from "../application/manage-catalog";
import type { StockAvailabilityReader } from "@/modules/inventory/public";
import { z } from "zod";
import { money } from "@/shared/domain/money";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { isNativeCatalogImageUrl } from "@/shared/infrastructure/config/native-catalog-image-config";
import { productId, type Product, type ProductId } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";

export const NATIVE_CATALOG_MAX_PRODUCTS = MAX_PUBLISHED_CATALOG_PRODUCTS;
const nativeId = /^native_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const slugSchema = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const rowSchema = z.object({
  id: z.uuid(),
  slug: slugSchema,
  status: z.literal("PUBLISHED"),
  available: z.boolean(),
  name: text(80),
  subtitle: text(120),
  description: text(2000),
  currency: z.literal("JPY"),
  price_minor: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative()),
  shipping_minor: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).nullable(),
  image_url: z.string().max(2048).refine(isNativeCatalogImageUrl),
  image_alt: text(200),
  palette: text(100),
  occasions: z.array(text(120)).min(1).max(20),
  flowers: z.array(text(120)).min(1).max(20),
  grower: text(120),
});

export class NativeCatalogUnavailableError extends Error {
  constructor() {
    super("Native catalog unavailable");
    this.name = "NativeCatalogUnavailableError";
  }
}

/** Read-only catalog adapter. No preview fallback, external calls or stock writes. */
export class PostgresProductRepository implements ProductRepository {
  constructor(private readonly sql: DatabaseClient, private readonly stock: StockAvailabilityReader) {}

  async findAvailable(): Promise<readonly Product[]> {
    return this.read(async () => {
      const rows = await this.sql`
        SELECT *, price_minor::text AS price_minor, shipping_minor::text AS shipping_minor FROM bloombox.catalog_products
        WHERE status = 'PUBLISHED' AND available = true
        ORDER BY slug, id LIMIT ${NATIVE_CATALOG_MAX_PRODUCTS + 1}
      `;
      if (rows.length > NATIVE_CATALOG_MAX_PRODUCTS) throw new NativeCatalogUnavailableError();
      const products = await this.withStock(rows.map(mapProduct));
      return products.filter((product) => product.available);
    });
  }

  async findById(id: ProductId): Promise<Product | null> {
    const match = nativeId.exec(id);
    if (!match) return null;
    return this.read(async () => {
      const rows = await this.sql`
        SELECT *, price_minor::text AS price_minor, shipping_minor::text AS shipping_minor FROM bloombox.catalog_products
        WHERE id = ${match[1]}::uuid AND status = 'PUBLISHED'
      `;
      return rows.length ? (await this.withStock([mapProduct(rows[0])]))[0] : null;
    });
  }

  async findBySlug(slug: string): Promise<Product | null> {
    if (!slugSchema.safeParse(slug).success) return null;
    return this.read(async () => {
      const rows = await this.sql`
        SELECT *, price_minor::text AS price_minor, shipping_minor::text AS shipping_minor FROM bloombox.catalog_products
        WHERE slug = ${slug} AND status = 'PUBLISHED'
      `;
      return rows.length ? (await this.withStock([mapProduct(rows[0])]))[0] : null;
    });
  }

  private async withStock(products: readonly Product[]): Promise<readonly Product[]> {
    const available = await this.stock.availableProductIds(products.map((product) => product.id));
    return products.map((product) => ({ ...product, available: product.available && available.has(product.id) }));
  }

  private async read<T>(query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch {
      // Preserve a distinct failure, without logging connection strings or database diagnostics.
      throw new NativeCatalogUnavailableError();
    }
  }
}

function mapProduct(value: unknown): Product {
  const row = rowSchema.parse(value);
  const id = productId(`native_${row.id}`);
  if (row.shipping_minor !== null) money(row.price_minor + row.shipping_minor);
  return {
    id,
    externalReference: id,
    slug: row.slug,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description,
    price: money(row.price_minor),
    shippingAmount: row.shipping_minor ?? undefined,
    imageUrl: row.image_url,
    imageAlt: row.image_alt,
    palette: row.palette,
    occasion: row.occasions,
    flowers: row.flowers,
    grower: row.grower,
    available: row.available,
  };
}
