import { PostgresInventoryReservations } from "@/modules/inventory/infrastructure/postgres-inventory-reservations";
import { PostgresStockAvailabilityReader } from "@/modules/inventory/infrastructure/postgres-stock-availability-reader";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { productId } from "../domain/product";
import { SearchProducts } from "../application/search-products";
import { PostgresProductRepository, NativeCatalogUnavailableError, NATIVE_CATALOG_MAX_PRODUCTS } from "./postgres-product-repository";
import { CreatePurchaseIntent } from "@/modules/checkout/application/create-purchase-intent";
import { PostgresPurchaseIntentRepository } from "@/modules/checkout/infrastructure/postgres-purchase-intent-repository";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeDatabase() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Isolated local test database required");
  }
  return databaseUrl;
}
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("native PostgreSQL catalog", () => {
  const sql = postgres(safeDatabase(), { max: 2, ssl: false });
  const repository = new PostgresProductRepository(sql, new PostgresStockAvailabilityReader(sql));
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let attempt = 0; attempt < 2; attempt++) {
      execFileSync("node", ["scripts/migrate-database.mjs"], {
        env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
      });
    }
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  beforeEach(async () => { await sql`TRUNCATE bloombox.inventory_movements, bloombox.inventory_reservations, bloombox.inventory_stock, bloombox.catalog_products`; });
  afterAll(async () => { await sql.end({ timeout: 5 }); });

  async function insert(options: { slug?: string; status?: string; available?: boolean; price?: number } = {}) {
    const id = randomUUID();
    await sql`INSERT INTO bloombox.catalog_products (
      id, slug, status, available, name, subtitle, description, price_minor, image_url, image_alt,
      palette, occasions, flowers, grower
    ) VALUES (
      ${id}, ${options.slug ?? 'test-' + id}, ${options.status ?? 'PUBLISHED'}, ${options.available ?? true},
      '試験商品', '試験用サブタイトル', 'テスト専用の商品説明', ${options.price ?? 4000},
      'https://images.unsplash.com/test-only', '試験画像', '白', ARRAY['お祝い'], ARRAY['試験用の花'], '試験用生産者'
    )`;
    await sql`INSERT INTO bloombox.inventory_stock (product_id, on_hand) VALUES (${id}, 100)`;
    return { id, publicId: productId(`native_${id}`) };
  }

  it("starts empty after repeated migration and never loads preview or Shopify products", async () => {
    expect(await repository.findAvailable()).toEqual([]);
    expect(await repository.findBySlug("bloom-box-m")).toBeNull();
    for (const input of ["prod_bloom_box_m", "shopify_123", "native_not-uuid", "native_'; DROP TABLE x", "native_" + randomUUID().toUpperCase()]) {
      expect(await repository.findById(productId(input))).toBeNull();
    }
    for (const input of ["x' OR true --", "../draft", "x".repeat(121)]) expect(await repository.findBySlug(input)).toBeNull();
    const migrations = await sql`SELECT version FROM bloombox.schema_migrations WHERE version = '0019'`;
    expect(migrations).toHaveLength(1);
  });

  it("hides drafts and archived products at every entry point, while unavailable published details remain visible", async () => {
    for (const status of ["DRAFT", "ARCHIVED"]) {
      const item = await insert({ status, available: false, slug: status.toLowerCase() });
      expect(await repository.findById(item.publicId)).toBeNull();
      expect(await repository.findBySlug(status.toLowerCase())).toBeNull();
    }
    const unavailable = await insert({ available: false, slug: "unavailable" });
    const published = await insert({ slug: "published" });
    expect((await repository.findAvailable()).map((row) => row.id)).toEqual([published.publicId]);
    expect(await repository.findById(unavailable.publicId)).toMatchObject({ available: false });
    expect(await repository.findBySlug("unavailable")).toMatchObject({ available: false });
    await sql`UPDATE bloombox.catalog_products SET available = false, status = 'ARCHIVED' WHERE id = ${published.id}`;
    expect(await repository.findById(published.publicId)).toBeNull();
    expect(await repository.findAvailable()).toEqual([]);
  });

  it("maps native IDs, JPY prices and content for existing search, without preview shipping or provider identifiers", async () => {
    const high = await insert({ slug: "b-flower", price: 8000 });
    const low = await insert({ slug: "a-flower", price: 4000 });
    expect((await repository.findAvailable()).map((row) => row.id)).toEqual([low.publicId, high.publicId]);
    const product = await repository.findById(low.publicId);
    expect(product).toMatchObject({ externalReference: low.publicId, price: { amount: 4000, currency: "JPY" }, occasion: ["お祝い"] });
    expect(product).not.toHaveProperty("previewOffer");
    expect(await repository.findBySlug("a-flower")).toEqual(product);
    const result = await new SearchProducts(repository).execute({ query: "試験", occasion: "お祝い", sort: "price-desc" });
    expect(result.products.map((row) => row.id)).toEqual([high.publicId, low.publicId]);
  });

  it("defaults to draft and unavailable and rejects duplicate slugs, non-JPY currency and invalid price bounds", async () => {
    const item = await insert({ slug: "unique" });
    await sql`UPDATE bloombox.catalog_products SET available = DEFAULT, status = DEFAULT WHERE id = ${item.id}`;
    const rows = await sql`SELECT status, available FROM bloombox.catalog_products WHERE id = ${item.id}`;
    expect(rows[0]).toEqual({ status: "DRAFT", available: false });
    await expect(insert({ slug: "unique" })).rejects.toThrow();
    await expect(sql`UPDATE bloombox.catalog_products SET available = true WHERE id = ${item.id}`).rejects.toThrow();
    await expect(sql`UPDATE bloombox.catalog_products SET currency = 'USD' WHERE id = ${item.id}`).rejects.toThrow();
    for (const price of ["-1", "9007199254740992"]) {
      await expect(sql`UPDATE bloombox.catalog_products SET price_minor = ${price}::bigint WHERE id = ${item.id}`).rejects.toThrow();
    }
    await sql`UPDATE bloombox.catalog_products SET price_minor = 9007199254740991, status = 'PUBLISHED' WHERE id = ${item.id}`;
    expect((await repository.findById(item.publicId))?.price.amount).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    "http://images.unsplash.com/test", "https://images.unsplash.com.attacker.test/test",
    "https://user:secret@images.unsplash.com/test", "https://images.unsplash.com:444/test",
    "https://images.unsplash.com/test#secret", "javascript:alert(1)", "https://127.0.0.1/private",
  ])("fails closed on an unsupported image without leaking its value: %s", async (imageUrl) => {
    const item = await insert();
    await sql`UPDATE bloombox.catalog_products SET image_url = ${imageUrl} WHERE id = ${item.id}`;
    await expect(repository.findById(item.publicId)).rejects.toThrow(new NativeCatalogUnavailableError());
    await expect(repository.findAvailable()).rejects.toThrow(new NativeCatalogUnavailableError());
  });

  it("rejects malformed DB lists and oversized catalogs instead of silently truncating or returning preview fixtures", async () => {
    const item = await insert();
    await sql`UPDATE bloombox.catalog_products SET flowers = ARRAY[''] WHERE id = ${item.id}`;
    await expect(repository.findById(item.publicId)).rejects.toThrow(NativeCatalogUnavailableError);
    await sql`UPDATE bloombox.catalog_products SET flowers = ARRAY['試験用の花'] WHERE id = ${item.id}`;
    await sql`INSERT INTO bloombox.catalog_products (
      id, slug, status, available, name, subtitle, description, currency, price_minor, image_url, image_alt, palette, occasions, flowers, grower
    ) SELECT md5('test-native-product-' || i::text)::uuid, 'test-' || i, status, available, name, subtitle, description,
      currency, price_minor, image_url, image_alt, palette, occasions, flowers, grower
      FROM bloombox.catalog_products CROSS JOIN generate_series(1, ${NATIVE_CATALOG_MAX_PRODUCTS}) i WHERE id = ${item.id}`;
    await expect(repository.findAvailable()).rejects.toThrow(NativeCatalogUnavailableError);
  });

  it("uses current DB prices at purchase creation and keeps the durable price snapshot on retries", async () => {
    const item = await insert();
    const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 7)]]) });
    const intents = new PostgresPurchaseIntentRepository(sql, protector, undefined, (tx) => new PostgresInventoryReservations(tx));
    // Isolated application test only. The production composition blocks new intake until reservations exist.
    const create = new CreatePurchaseIntent(repository, intents, () => new Date("2026-09-13T00:00:00Z"));
    const input = { requestId: randomUUID(), productId: item.publicId, quantity: 2, recipientName: "試験用受取人", deliveryDate: "2026-09-20", giftMessage: "試験" };
    const first = await create.execute(input);
    await sql`UPDATE bloombox.catalog_products SET price_minor = 5000, version = version + 1 WHERE id = ${item.id}`;
    const repeated = await create.execute(input);
    const fresh = await create.execute({ ...input, requestId: randomUUID() });
    expect(first.item.subtotal.amount).toBe(8000);
    expect(repeated.item.subtotal.amount).toBe(8000);
    expect(fresh.item.subtotal.amount).toBe(10000);
    await sql`UPDATE bloombox.catalog_products SET available = false WHERE id = ${item.id}`;
    await expect(create.execute({ ...input, requestId: randomUUID() })).rejects.toThrow("現在ご注文いただけません");
  });

  it("permits role-scoped reads but prevents storefront and worker price/publication writes; read failures recover explicitly", async () => {
    const item = await insert();
    const connection = postgres(safeDatabase(), { max: 1, ssl: false });
    const reader = new PostgresProductRepository(connection, new PostgresStockAvailabilityReader(connection));
    try {
      for (const role of ["bloombox_application", "bloombox_worker"]) {
        await connection.unsafe(`SET ROLE ${role}`);
        expect(await reader.findById(item.publicId)).toMatchObject({ id: item.publicId });
        await expect(connection`UPDATE bloombox.catalog_products SET price_minor = 0 WHERE id = ${item.id}`).rejects.toThrow();
        await expect(connection`DELETE FROM bloombox.catalog_products WHERE id = ${item.id}`).rejects.toThrow();
        await expect(connection`INSERT INTO bloombox.catalog_products SELECT * FROM bloombox.catalog_products`).rejects.toThrow();
        await connection`RESET ROLE`;
      }
      await connection`REVOKE SELECT ON bloombox.catalog_products FROM bloombox_application`;
      await connection`SET ROLE bloombox_application`;
      await expect(reader.findAvailable()).rejects.toThrow(new NativeCatalogUnavailableError());
      await connection`RESET ROLE`;
      await connection`GRANT SELECT ON bloombox.catalog_products TO bloombox_application`;
      await connection`SET ROLE bloombox_application`;
      expect(await reader.findAvailable()).toHaveLength(1);
    } finally {
      await connection`RESET ROLE`;
      await connection`GRANT SELECT ON bloombox.catalog_products TO bloombox_application`;
      await connection.end({ timeout: 5 });
    }
  });
});
