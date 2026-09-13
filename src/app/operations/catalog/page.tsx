import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CatalogManagementError } from "@/modules/catalog/public";
import { catalogManagementContent as copy } from "@/shared/infrastructure/content/catalog-management-content";
import { readManagedCatalog } from "@/shared/infrastructure/security/operator-auth/native-catalog-management";
import { CatalogManagementForm, StockManagementForm } from "@/ui/catalog-management-form";
import { saveCatalogManagement } from "./actions";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {title:copy.title, robots:{index:false, follow:false}};
export default async function CatalogManagement({searchParams}:{searchParams:Promise<{after?:string|string[]}>}) {
  const input = z.object({after:z.uuid().optional()}).strict().safeParse(await searchParams);
  const state = input.success ? await load(input.data.after) : {page:null, error:copy.messages.INVALID};
  return <section className="section-shell content-page catalog-management-page">
    <header className="content-header"><p className="eyebrow">BLOOMBOX OPERATIONS</p><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.page ? <><details className="catalog-management-card"><summary>{copy.newProduct}</summary>
      <CatalogManagementForm id={randomUUID()} requestId={randomUUID()} action={saveCatalogManagement}/></details>
      <h2>{copy.products}</h2><p>{copy.stockMeaning}</p>
      {!state.page.products.length ? <p>{copy.empty}</p> : null}
      {state.page.products.map((product) => { const stock = state.page.stock.find((s) => s.productId === product.id);
        return <article className="catalog-management-card" key={product.id}><h3>{product.name}</h3><p>{copy.statuses[product.status]} · {product.available ? copy.yes : copy.no}</p>
          {stock ? <dl className="catalog-stock-summary"><div><dt>{copy.onHand}</dt><dd>{stock.onHand}</dd></div><div><dt>{copy.reserved}</dt><dd>{stock.reserved}</dd></div><div><dt>{copy.sellable}</dt><dd>{stock.onHand-stock.reserved}</dd></div></dl> : <p>{copy.unregistered}</p>}
          <StockManagementForm productId={product.id} stock={stock} requestId={randomUUID()} action={saveCatalogManagement}/>
          <details><summary>{copy.edit}</summary><CatalogManagementForm product={product} id={product.id} requestId={randomUUID()} action={saveCatalogManagement}/></details>
        </article>; })}
      <nav aria-label={copy.products}><Link className="text-link" href="/operations/catalog">{copy.first}</Link>
        {state.page.next ? <Link className="text-link" href={`/operations/catalog?after=${state.page.next}`}>{copy.next}</Link> : null}</nav>
    </> : null}<Link className="text-link" href="/operations">{copy.login}</Link>
  </section>;
}
async function load(after?:string) {
  try { return {page:await readManagedCatalog(after), error:null}; }
  catch (error) {
    if (error instanceof CatalogManagementError && error.code === "DENIED") notFound();
    console.error("native_catalog_management_read_unavailable");
    return {page:null, error:copy.messages.UNAVAILABLE};
  }
}
