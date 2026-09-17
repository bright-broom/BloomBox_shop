export const CATALOG_HISTORY_PAGE_SIZE = 30;
export const CATALOG_HISTORY_FIELDS = ["slug", "name", "subtitle", "description", "price", "shippingAmount", "imageUrl", "imageAlt", "palette", "occasions", "flowers", "grower", "status", "available"] as const;
export type CatalogHistoryField = typeof CATALOG_HISTORY_FIELDS[number];
export type CatalogHistoryValue = string | number | boolean | null | readonly string[];
export type CatalogHistoryEntry = Readonly<{
  operatorId: string; requestId: string; occurredAt: string; version: number;
  changes: readonly Readonly<{ field: CatalogHistoryField; before: CatalogHistoryValue; after: CatalogHistoryValue }>[];
}>;
export type CatalogHistoryPage = Readonly<{ entries: readonly CatalogHistoryEntry[]; next: number | null }>;
