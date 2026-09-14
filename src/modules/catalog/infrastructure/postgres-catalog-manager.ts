import { z } from "zod";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import { isNativeCatalogImageUrl } from "@/shared/infrastructure/config/native-catalog-image-config";
import { MAX_PUBLISHED_CATALOG_PRODUCTS, CATALOG_MANAGEMENT_PAGE_SIZE, CatalogManagementError, type CatalogManager, type CatalogSave, type ManagementActor, type ManagedProduct } from "../application/manage-catalog";
const text = (max: number) => z.string().trim().min(1).max(max);
export const catalogSaveSchema = z.object({
  id: z.uuid(), expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), requestId: z.uuid(),
  slug: z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: text(80), subtitle: text(120), description: text(2000),
  price: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), imageUrl: z.string().max(2048).refine(isNativeCatalogImageUrl),
  shippingAmount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().default(null),
  imageAlt: text(200), palette: text(100), occasions: z.array(text(120)).min(1).max(20), flowers: z.array(text(120)).min(1).max(20), grower: text(120),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]), available: z.boolean(),
}).strict().refine((p) => !p.available || p.status === "PUBLISHED")
  .refine((p) => p.shippingAmount === null || Number.isSafeInteger(p.price + p.shippingAmount));
export class PostgresCatalogManager implements CatalogManager {
  constructor(private readonly tx: DatabaseTransaction) {}
  async list(after?: string) {
    if (after !== undefined && !z.uuid().safeParse(after).success) throw new CatalogManagementError("INVALID");
    const rows = await this.tx`SELECT * FROM bloombox.catalog_products WHERE (${after ?? null}::uuid IS NULL OR id > ${after ?? null}::uuid)
      ORDER BY id LIMIT ${CATALOG_MANAGEMENT_PAGE_SIZE + 1}`;
    const products = rows.slice(0, CATALOG_MANAGEMENT_PAGE_SIZE).map((r): ManagedProduct => {
      const command = catalogSaveSchema.parse({ id: r.id, expectedVersion: Number(r.version), requestId: r.id, slug: r.slug, name: r.name,
        subtitle: r.subtitle, description: r.description, price: Number(r.price_minor), shippingAmount: r.shipping_minor === null ? null : Number(r.shipping_minor), imageUrl: r.image_url, imageAlt: r.image_alt,
        palette: r.palette, occasions: r.occasions, flowers: r.flowers, grower: r.grower, status: r.status, available: r.available });
      return { id: command.id, version: command.expectedVersion, slug: command.slug, name: command.name, subtitle: command.subtitle,
        description: command.description, price: command.price, shippingAmount: command.shippingAmount, imageUrl: command.imageUrl, imageAlt: command.imageAlt, palette: command.palette,
        occasions: command.occasions, flowers: command.flowers, grower: command.grower, status: command.status, available: command.available };
    });
    return { products, next: rows.length > CATALOG_MANAGEMENT_PAGE_SIZE ? products.at(-1)!.id : null };
  }
  async save(input: CatalogSave, actor: ManagementActor) {
    const parsed = catalogSaveSchema.safeParse(input);
    if (!parsed.success) throw new CatalogManagementError("INVALID");
    const p = parsed.data;
    // Covers creation as well as updates; no external calls inside this transaction.
    await this.tx`SELECT pg_advisory_xact_lock(hashtextextended(${"catalog:management"}, 0))`;
    const [prior] = await this.tx`SELECT (jsonb_build_object('shippingAmount', NULL) || command) = ${this.tx.json(p)} AS matches FROM bloombox.catalog_changes
      WHERE operator_id = ${actor.operatorId} AND request_id = ${p.requestId}`;
    if (prior) { if (!prior.matches) throw new CatalogManagementError("CONFLICT"); return; }
    const [current] = await this.tx`SELECT version, to_jsonb(catalog_products) AS snapshot FROM bloombox.catalog_products WHERE id = ${p.id} FOR UPDATE`;
    if (Number(current?.version ?? 0) !== p.expectedVersion) throw new CatalogManagementError("CONFLICT");
    if (p.status === "PUBLISHED" && p.available) {
      const [count] = await this.tx`SELECT count(*)::integer AS total FROM bloombox.catalog_products WHERE status='PUBLISHED' AND available=true AND id <> ${p.id}`;
      if (count.total >= MAX_PUBLISHED_CATALOG_PRODUCTS) throw new CatalogManagementError("INVALID");
    }
    if (!current) {
      if (p.status !== "DRAFT" || p.available) throw new CatalogManagementError("INVALID");
      await this.tx`INSERT INTO bloombox.catalog_products (id, slug, status, available, name, subtitle, description, price_minor, shipping_minor,
        image_url, image_alt, palette, occasions, flowers, grower)
        VALUES (${p.id}, ${p.slug}, ${p.status}, ${p.available}, ${p.name}, ${p.subtitle}, ${p.description}, ${p.price}, ${p.shippingAmount},
          ${p.imageUrl}, ${p.imageAlt}, ${p.palette}, ${this.tx.array(p.occasions)}, ${this.tx.array(p.flowers)}, ${p.grower})`;
    } else {
      await this.tx`UPDATE bloombox.catalog_products SET slug=${p.slug}, status=${p.status}, available=${p.available}, name=${p.name},
        subtitle=${p.subtitle}, description=${p.description}, price_minor=${p.price}, shipping_minor=${p.shippingAmount}, image_url=${p.imageUrl}, image_alt=${p.imageAlt},
        palette=${p.palette}, occasions=${this.tx.array(p.occasions)}, flowers=${this.tx.array(p.flowers)}, grower=${p.grower},
        version=version+1, updated_at=clock_timestamp() WHERE id=${p.id}`;
    }
    await this.tx`INSERT INTO bloombox.catalog_changes (operator_id, request_id, product_id, previous_version, version, before_snapshot, command)
      VALUES (${actor.operatorId}, ${p.requestId}, ${p.id}, ${p.expectedVersion}, ${p.expectedVersion + 1}, ${this.tx.json(current?.snapshot ?? null)}, ${this.tx.json(p)})`;
  }
}
