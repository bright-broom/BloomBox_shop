import Link from 'next/link';
import { CUSTOMER_SUPPORT_SEARCH_MAX_LENGTH, type ManagedCustomer } from '@/modules/customer/public';
import type { SupportOrder } from '@/modules/order/public';
import { customerManagementContent as copy } from '@/shared/infrastructure/content/customer-management-content';
const date = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium' }).format(new Date(value));
const money = (value: number) => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value);
function status(values: readonly string[], labels: Readonly<Record<string, string>>) {
  if (values.length > 1) return copy.multiple;
  return values.length === 1 && Object.hasOwn(labels, values[0]) ? labels[values[0]] : copy.unknown;
}
export function CustomerDirectoryPanel({ page, error, filters }: {
  page?: Readonly<{ customers: readonly ManagedCustomer[]; next: string | null }>; error?: string;
  filters: Readonly<{ q?: string; status?: string; after?: string }>;
}) {
  const nextParams = new URLSearchParams();
  if (filters.q) nextParams.set('q', filters.q);
  if (filters.status) nextParams.set('status', filters.status);
  if (page?.next) nextParams.set('after', page.next);
  return <>
    <form className="customer-management-search" action="/operations/customers" method="get">
      <div className="form-field"><label htmlFor="customer-query">{copy.searchLabel}</label>
        <input id="customer-query" name="q" type="search" maxLength={CUSTOMER_SUPPORT_SEARCH_MAX_LENGTH} defaultValue={filters.q ?? ''} aria-describedby="customer-search-hint" autoComplete="off" />
        <p id="customer-search-hint">{copy.searchHint}</p></div>
      <div className="form-field"><label htmlFor="customer-status">{copy.statusLabel}</label>
        <select id="customer-status" name="status" defaultValue={filters.status ?? ''}>
          <option value="">{copy.all}</option>{Object.entries(copy.statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></div>
      <div><button className="primary-button" type="submit">{copy.search}</button><Link className="text-link" prefetch={false} href="/operations/customers">{copy.reset}</Link></div>
    </form>
    {error ? <p role="alert">{error}</p> : null}
    {page ? <>
      {!page.customers.length ? <p>{copy.empty}</p> : <ul className="account-order-list">{page.customers.map((customer) => <li key={customer.id}>
        <h2 className="customer-management-id">{customer.id}</h2>
        <dl className="account-order-facts"><div><dt>{copy.statusLabel}</dt><dd>{copy.statuses[customer.status]}</dd></div>
          <div><dt>{copy.registeredAt}</dt><dd><time dateTime={customer.createdAt}>{date(customer.createdAt)}</time></dd></div></dl>
        {customer.status === 'ANONYMIZED' ? <p>{copy.anonymized}</p>
          : <Link className="text-link" prefetch={false} href={`/operations/customers/${customer.id}`}>{copy.history}</Link>}
      </li>)}</ul>}
      <nav aria-label={copy.title}><Link className="text-link" prefetch={false} href="/operations/customers">{copy.first}</Link>
        {page.next ? <Link className="text-link" prefetch={false} href={`/operations/customers?${nextParams}`}>{copy.next}</Link> : null}</nav>
    </> : null}
  </>;
}
export function CustomerHistoryPanel({ page }: { page: Readonly<{ customer: ManagedCustomer; orders: readonly SupportOrder[]; next: string | null }> }) {
  return <>
    <dl><dt>{copy.customerId}</dt><dd className="customer-management-id">{page.customer.id}</dd><dt>{copy.statusLabel}</dt><dd>{copy.statuses[page.customer.status]}</dd></dl>
    {!page.orders.length ? <p>{copy.ordersEmpty}</p> : <ul className="account-order-list">{page.orders.map((order) => <li key={order.id}>
      <h2 className="customer-management-id">{order.name}</h2>
      <dl className="account-order-facts"><div><dt>{copy.orderedAt}</dt><dd><time dateTime={order.orderedAt}>{date(order.orderedAt)}</time></dd></div>
        <div><dt>{copy.total}</dt><dd>{money(order.totalYen)}</dd></div><div><dt>{copy.orderStatus}</dt><dd>{status([order.status], copy.orderStatuses)}</dd></div>
        <div><dt>{copy.payment}</dt><dd>{status(order.payment, copy.paymentStatuses)}</dd></div>
        <div><dt>{copy.fulfillment}</dt><dd>{status(order.fulfillment, copy.fulfillmentStatuses)}</dd></div></dl>
    </li>)}</ul>}
    <nav aria-label={copy.historyTitle}><Link className="text-link" prefetch={false} href={`/operations/customers/${page.customer.id}`}>{copy.first}</Link>
      {page.next ? <Link className="text-link" prefetch={false} href={`/operations/customers/${page.customer.id}?after=${page.next}`}>{copy.next}</Link> : null}</nav>
  </>;
}
