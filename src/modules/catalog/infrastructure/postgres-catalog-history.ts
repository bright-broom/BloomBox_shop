import { z } from "zod";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import { CatalogManagementError } from "../application/manage-catalog";
import { CATALOG_HISTORY_FIELDS, CATALOG_HISTORY_PAGE_SIZE, type CatalogHistoryEntry, type CatalogHistoryPage } from "../application/catalog-history";

const snapshot = z.object({
  slug: z.string(), name: z.string(), subtitle: z.string(), description: z.string(),
  price: z.number().int().nonnegative().safe(), shippingAmount: z.number().int().nonnegative().safe().nullable().default(null),
  imageUrl: z.string(), imageAlt: z.string(), palette: z.string(), occasions: z.array(z.string()), flowers: z.array(z.string()),
  grower: z.string(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]), available: z.boolean(),
});
const record = z.object({ operator_id: z.uuid(), request_id: z.uuid(), occurred_at: z.date(), version: z.coerce.number().int().positive().safe(),
  before_snapshot: z.record(z.string(), z.unknown()).nullable(), command: snapshot });

export class PostgresCatalogHistory {
  constructor(private readonly tx: DatabaseTransaction) {}
  async read(productId: string, before?: number): Promise<CatalogHistoryPage> {
    if (!z.object({ productId: z.uuid(), before: z.number().int().positive().safe().optional() }).safeParse({ productId, before }).success) throw new CatalogManagementError("INVALID");
    // Product + version uses the existing unique index. No unbounded scan or offset pagination.
    const rows = await this.tx`SELECT operator_id, request_id, occurred_at, version, before_snapshot, command
      FROM bloombox.catalog_changes WHERE product_id = ${productId}
      AND (${before ?? null}::bigint IS NULL OR version < ${before ?? null}) ORDER BY version DESC LIMIT ${CATALOG_HISTORY_PAGE_SIZE + 1}`;
    const entries = rows.slice(0, CATALOG_HISTORY_PAGE_SIZE).map((row): CatalogHistoryEntry => {
      const value = record.parse(row), prior = value.before_snapshot;
      // Read historic values without re-applying today's image-host or publication policy.
      const previous = prior === null ? null : snapshot.parse({ ...prior, price: Number(prior.price_minor),
        shippingAmount: prior.shipping_minor == null ? null : Number(prior.shipping_minor), imageUrl: prior.image_url, imageAlt: prior.image_alt });
      return { operatorId: value.operator_id, requestId: value.request_id, occurredAt: value.occurred_at.toISOString(), version: value.version,
        changes: CATALOG_HISTORY_FIELDS.filter((field) => previous === null || JSON.stringify(previous[field]) !== JSON.stringify(value.command[field]))
          .map((field) => ({ field, before: previous?.[field] ?? null, after: value.command[field] })) };
    });
    return { entries, next: rows.length > CATALOG_HISTORY_PAGE_SIZE ? entries.at(-1)!.version : null };
  }
}
