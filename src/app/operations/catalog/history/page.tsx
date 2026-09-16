import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CatalogManagementError } from "@/modules/catalog/public";
import { requireOperatorLogin } from "@/shared/infrastructure/security/auth-entry";
import { readManagedCatalogHistory } from "@/shared/infrastructure/security/operator-auth/native-catalog-management";
import { catalogHistoryContent as copy } from "@/shared/infrastructure/content/catalog-history-content";
import { CatalogHistoryPanel, type HistoryFilters } from "@/ui/catalog-history";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
const filtersSchema = z.object({ productId: z.uuid().optional(), kind: z.enum(["catalog", "stock"]).default("catalog"),
  before: z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).pipe(z.number().int().positive().safe()).optional(),
}).strict().refine((input) => input.before === undefined || input.productId !== undefined);
export default async function CatalogHistory({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOperatorLogin("/operations/catalog/history");
  const parsed = filtersSchema.safeParse(await searchParams);
  const filters: HistoryFilters = parsed.success ? parsed.data : { kind: "catalog" };
  const state = await load(filters);
  return <section className="section-shell content-page catalog-management-page">
    <header className="content-header"><p className="eyebrow">BLOOMBOX OPERATIONS</p><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    <CatalogHistoryPanel filters={filters} page={state.page} error={state.error ?? (parsed.success ? undefined : copy.invalid)} />
    <Link className="text-link" prefetch={false} href="/operations/catalog">{copy.back}</Link>
  </section>;
}
async function load(filters: HistoryFilters) {
  try { return { page: await readManagedCatalogHistory(filters), error: undefined }; }
  catch (error) {
    if (error instanceof CatalogManagementError && error.code === "DENIED") notFound();
    console.error("native_catalog_history_read_unavailable");
    return { page: null, error: copy.unavailable };
  }
}
