export const MAX_PUBLISHED_CATALOG_PRODUCTS = 1000;
export const CATALOG_MANAGEMENT_PAGE_SIZE = 30;
export type CatalogFields = Readonly<{
  slug: string; name: string; subtitle: string; description: string; price: number;
  shippingAmount?: number | null;
  imageUrl: string; imageAlt: string; palette: string; occasions: readonly string[]; flowers: readonly string[]; grower: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; available: boolean;
}>;
export type ManagedProduct = CatalogFields & Readonly<{ id: string; version: number }>;
export type CatalogSave = CatalogFields & Readonly<{ id: string; expectedVersion: number; requestId: string }>;
export type ManagementActor = Readonly<{ operatorId: string; expiresAt: Date }>;
export class CatalogManagementError extends Error {
  constructor(readonly code: "INVALID" | "DENIED" | "CONFLICT" | "UNAVAILABLE") { super(code); this.name = "CatalogManagementError"; }
}
export interface CatalogManager {
  list(after?: string): Promise<Readonly<{ products: readonly ManagedProduct[]; next: string | null }>>;
  save(command: CatalogSave, actor: ManagementActor): Promise<void>;
}
