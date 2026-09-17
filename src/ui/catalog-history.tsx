import Link from "next/link";
import type { CatalogHistoryPage, CatalogHistoryValue, CatalogHistoryField } from "@/modules/catalog/public";
import type { StockHistoryPage } from "@/modules/inventory/public";
import { catalogHistoryContent as copy } from "@/shared/infrastructure/content/catalog-history-content";
import { catalogManagementContent as catalog } from "@/shared/infrastructure/content/catalog-management-content";
import styles from "./catalog-history.module.css";
export type CatalogHistoryResult = ({ kind: "catalog" } & CatalogHistoryPage) | ({ kind: "stock" } & StockHistoryPage);
export type HistoryFilters = { productId?: string; kind: "catalog" | "stock"; before?: number };
const date = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
function fieldLabel(field: CatalogHistoryField) { return field === "shippingAmount" ? catalog.shippingLabel : catalog.labels[field]; }
function display(value: CatalogHistoryValue, field: CatalogHistoryField): string {
  if (value === null) return copy.unset;
  if (typeof value === "boolean") return value ? catalog.yes : catalog.no;
  if (typeof value === "number") return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(value);
  if (Array.isArray(value)) return value.join("、");
  if (field === "status" && typeof value === "string" && (value === "DRAFT" || value === "PUBLISHED" || value === "ARCHIVED")) return catalog.statuses[value];
  return String(value);
}
function historyUrl(filters: HistoryFilters, before?: number) {
  const params = new URLSearchParams({ productId: filters.productId ?? "", kind: filters.kind });
  if (before !== undefined) params.set("before", String(before));
  return `/operations/catalog/history?${params}`;
}
export function CatalogHistoryPanel({ filters, page, error }: { filters: HistoryFilters; page: CatalogHistoryResult | null; error?: string }) {
  return <>
    <form className="customer-management-search" action="/operations/catalog/history" method="get">
      <div className="form-field"><label htmlFor="history-product">{copy.productId}</label>
        <input id="history-product" name="productId" defaultValue={filters.productId ?? ""} required aria-describedby="history-product-hint" />
        <p id="history-product-hint">{copy.productHint}</p></div>
      <div className="form-field"><label htmlFor="history-kind">{copy.kind}</label><select id="history-kind" name="kind" defaultValue={filters.kind}>
        <option value="catalog">{copy.catalog}</option><option value="stock">{copy.stock}</option></select></div>
      <button className="primary-button" type="submit">{copy.search}</button>
    </form>
    {error ? <p role="alert">{error}</p> : null}
    {!error && !page ? <p>{copy.initial}</p> : null}
    {page ? <section aria-label={page.kind === "catalog" ? copy.catalog : copy.stock}>
      <p>{copy.timeZone}</p>{page.kind === "stock" ? <p>{copy.stockNote}</p> : null}
      {!page.entries.length ? <p>{copy.empty}</p> : null}
      <ol className={styles.list}>{page.entries.map((entry) => <li className={`catalog-management-card ${styles.entry}`} key={`${entry.operatorId}:${entry.requestId}`}>
        <h2>{copy.version} {entry.version}</h2><time dateTime={entry.occurredAt}>{date(entry.occurredAt)}</time>
        {"changes" in entry ? <>
          {entry.version === 1 ? <p>{copy.created}</p> : null}
          {!entry.changes.length ? <p>{copy.unchanged}</p> : null}
          {entry.changes.map((change) => <div className={styles.change} key={change.field}><h3>{fieldLabel(change.field)}</h3>
            <dl className={styles.values}><div><dt>{copy.before}</dt><dd>{display(change.before, change.field)}</dd></div>
              <div><dt>{copy.after}</dt><dd>{display(change.after, change.field)}</dd></div></dl></div>)}
        </> : <><h3>{entry.reason === "RECEIVED" ? copy.received : copy.correction}</h3>
          <dl className={styles.values}><div><dt>{copy.before} · {copy.quantity}</dt><dd>{entry.beforeQuantity}</dd></div>
            <div><dt>{copy.after} · {copy.quantity}</dt><dd>{entry.afterQuantity}</dd></div><div><dt>{copy.delta}</dt><dd>{entry.delta > 0 ? "+" : ""}{entry.delta}</dd></div></dl></>}
        <details><summary>{copy.operator} / {copy.request}</summary><dl className={styles.identifiers}>
          <div><dt>{copy.operator}</dt><dd>{entry.operatorId}</dd></div><div><dt>{copy.request}</dt><dd>{entry.requestId}</dd></div></dl></details>
      </li>)}</ol>
      <nav className={styles.pagination} aria-label={copy.pagination}>
        {filters.before ? <Link className="text-link" prefetch={false} href={historyUrl(filters)}>{copy.first}</Link> : null}
        {page.next ? <Link className="text-link" prefetch={false} href={historyUrl(filters, page.next)}>{copy.next}</Link> : null}
      </nav>
    </section> : null}
  </>;
}
