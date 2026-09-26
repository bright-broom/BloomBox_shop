import Link from "next/link";
import type {
  OperatorOrderPage,
  OperatorOrderReport,
} from "@/modules/order/public";
import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
import { customerManagementContent as states } from "@/shared/infrastructure/content/customer-management-content";
import type { ConsoleResource } from "@/shared/infrastructure/security/operator-auth/console-resource";
import { OperationsRefresh } from "./operations-refresh";
import { OperationsIcon } from "./operations-icon";
export const operationsMoney = (value: number) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(
    value,
  );
export const operationsDate = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
  }).format(new Date(value));
export function ConsoleHeader({
  title,
  lead,
}: {
  title: string;
  lead: string;
}) {
  return (
    <header className="ops-heading">
      <div>
        <p className="eyebrow">BLOOMBOX OPERATIONS</p>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      <Link
        className="secondary-button"
        href="/operations/settings"
        prefetch={false}
      >
        <OperationsIcon name="lock" />
        {copy.settings}
      </Link>
    </header>
  );
}
export function ConsoleState({
  status,
}: {
  status: Exclude<ConsoleResource<never>["status"], "ready">;
}) {
  return (
    <div
      className="ops-state"
      role={
        status === "unavailable" || status === "invalid" ? "alert" : undefined
      }
    >
      <OperationsIcon name="lock" />
      <h2>{copy[status]}</h2>
      <p>{copy[`${status}Note`]}</p>
      <Link
        className="text-link"
        prefetch={false}
        href={
          status === "invalid" ? "/operations/orders" : "/operations/settings"
        }
      >
        {status === "invalid" ? copy.reset : copy.settings}
      </Link>
    </div>
  );
}
export function ReportMetrics({ report }: { report: OperatorOrderReport }) {
  // Counts that ask for work link to where that work is done and are marked while any remain.
  const items = [
    { label: copy.orderValue, value: operationsMoney(report.orderValueYen), icon: "reports" as const, pending: 0, href: null },
    { label: copy.orderCount, value: `${report.orders} ${copy.unit}`, icon: "orders" as const, pending: 0, href: null },
    { label: copy.awaiting, value: `${report.awaitingShipment} ${copy.unit}`, icon: "truck" as const,
      pending: report.awaitingShipment, href: "/operations/native-fulfillments" },
    { label: copy.refunds, value: `${report.refunds} ${copy.unit}`, icon: "clock" as const,
      pending: report.refunds, href: "/operations/orders" },
  ];
  return (
    <>
      <div className="ops-metrics">
        {items.map((item) => {
          const body = <>
            <div>
              <span>{item.label}</span>
              {item.pending > 0 ? <span className="ops-attention">{copy.attention}</span> : <OperationsIcon name={item.icon} />}
            </div>
            <strong>{item.value}</strong>
          </>;
          return item.href ? (
            <Link key={item.label} className={`ops-metric${item.pending > 0 ? " is-attention" : ""}`} href={item.href} prefetch={false}>
              {body}
              <OperationsIcon name="arrow" />
            </Link>
          ) : <article className="ops-metric" key={item.label}>{body}</article>;
        })}
      </div>
      <p className="ops-caption">
        {copy.valueNote} {copy.queueNote}
      </p>
    </>
  );
}
export function DailyReport({ report }: { report: OperatorOrderReport }) {
  const max = Math.max(1, ...report.daily.map((d) => d.orders));
  const last = report.daily.length - 1;
  return (
    <section className="ops-panel">
      <h2>{copy.daily}</h2>
      <p className="ops-chart-peak">{copy.chartPeak} <strong>{max}{copy.unit}</strong></p>
      <div
        className="ops-chart"
        role="img"
        aria-label={`${copy.daily}：${report.days}${copy.days}、${report.orders}${copy.unit}`}
      >
        {report.daily.map((day, index) => (
          <div key={day.day} className={`ops-chart-column${index === last ? " is-latest" : ""}`}
            data-tip={`${day.day}　${day.orders}${copy.unit}・${operationsMoney(day.orderValueYen)}`}>
            <span style={{ height: `${(day.orders / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="ops-chart-axis">
        <span>{report.daily.at(0)?.day}</span>
        <span><i aria-hidden="true" />{copy.latest} {report.daily.at(-1)?.day}</span>
      </div>
      <details>
        <summary>
          {copy.daily}・{copy.date}
        </summary>
        <div
          className="ops-table-scroll"
          role="region"
          aria-label={copy.daily}
          tabIndex={0}
        >
          <table className="ops-table">
            <thead>
              <tr>
                <th>{copy.date}</th>
                <th>{copy.orderCount}</th>
                <th>{copy.orderValue}</th>
              </tr>
            </thead>
            <tbody>
              {report.daily.map((day) => (
                <tr key={day.day}>
                  <th scope="row">{day.day}</th>
                  <td>{day.orders}</td>
                  <td>{operationsMoney(day.orderValueYen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="ops-caption">
        {copy.updated}：
        <time dateTime={report.until}>
          {new Intl.DateTimeFormat("ja-JP", {
            timeZone: "Asia/Tokyo",
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(report.until))}
        </time>
      </p>
    </section>
  );
}
// Statuses that still need an operator are tinted; finished ones are quiet. The label always carries the meaning.
const attentionStatuses = new Set([
  "UNFULFILLED", "SCHEDULED", "PROCESSING", "READY", "ON_HOLD",
  "FAILED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED", "REQUIRES_ACTION", "REQUIRES_PAYMENT_METHOD",
]);
function StatusBadges({ values, dictionary }: { values: readonly string[]; dictionary: Readonly<Record<string, string>> }) {
  if (!values.length) return <span className="ops-badge">{copy.unknown}</span>;
  return <span className="ops-badges">{values.map((value) => (
    <span key={value} className={`ops-badge${attentionStatuses.has(value) ? " is-attention" : ""}`}>
      {dictionary[value] ?? copy.unknown}
    </span>
  ))}</span>;
}
export function OrdersTable({ page }: { page: OperatorOrderPage }) {
  if (!page.orders.length)
    return (
      <div className="ops-state">
        <OperationsIcon name="orders" />
        <h2>{copy.empty}</h2>
        <p>{copy.emptyNote}</p>
      </div>
    );
  return (
    <div
      className="ops-table-scroll"
      role="region"
      aria-label={copy.orders}
      tabIndex={0}
    >
      <table className="ops-table">
        <caption className="sr-only">{copy.orders}</caption>
        <thead>
          <tr>
            <th>{copy.reference}</th>
            <th>{copy.orderedAt}</th>
            <th>{copy.total}</th>
            <th>{copy.orderStatus}</th>
            <th>{copy.payment}</th>
            <th>{copy.fulfillment}</th>
            <th>{copy.customers}</th>
          </tr>
        </thead>
        <tbody>
          {page.orders.map((o) => (
            <tr key={o.id}>
              <th scope="row">
                <span className="ops-order-reference">{o.name}</span>
              </th>
              <td>
                <time dateTime={o.orderedAt}>
                  {operationsDate(o.orderedAt)}
                </time>
              </td>
              <td className="ops-amount">{operationsMoney(o.totalYen)}</td>
              <td>
                <StatusBadges values={[o.status]} dictionary={states.orderStatuses} />
              </td>
              <td><StatusBadges values={o.payment} dictionary={states.paymentStatuses} /></td>
              <td><StatusBadges values={o.fulfillment} dictionary={states.fulfillmentStatuses} /></td>
              <td>
                {o.customerId ? (
                  <Link
                    className="text-link"
                    href={`/operations/customers/${o.customerId}`}
                    prefetch={false}
                    aria-label={`${o.name}・${copy.customerHistory}`}
                  >
                    {copy.customerHistory}
                    <OperationsIcon name="arrow" />
                  </Link>
                ) : (
                  copy.guest
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function OperationsDashboard({
  report,
  orders,
}: {
  report: ConsoleResource<OperatorOrderReport>;
  orders: ConsoleResource<OperatorOrderPage>;
}) {
  if (report.status === "unbound")
    return (
      <>
        <ConsoleHeader title={copy.title} lead={copy.lead} />
        <ConsoleState status="unbound" />
        <OperationsQuickLinks />
      </>
    );
  return (
    <>
      <ConsoleHeader title={copy.title} lead={copy.lead} />
      <div className="ops-toolbar">
        <span>
          {copy.todayIncluded}・30{copy.days}
        </span>
        <OperationsRefresh />
      </div>
      {report.status === "ready" ? (
        <ReportMetrics report={report.value} />
      ) : (
        <ConsoleState status={report.status} />
      )}
      <div className="ops-dashboard-columns">
        {report.status === "ready" ? (
          <DailyReport report={report.value} />
        ) : (
          <section className="ops-panel">
            <h2>{copy.daily}</h2>
            <p>{copy.unavailableNote}</p>
          </section>
        )}
        <OperationsQuickLinks />
      </div>
      <section className="ops-panel">
        <div className="ops-section-heading">
          <h2>{copy.recent}</h2>
          <Link
            className="text-link"
            href="/operations/orders"
            prefetch={false}
          >
            {copy.viewAll}
            <OperationsIcon name="arrow" />
          </Link>
        </div>
        {orders.status === "ready" ? (
          <OrdersTable page={orders.value} />
        ) : (
          <ConsoleState status={orders.status} />
        )}
      </section>
    </>
  );
}

function OperationsQuickLinks() {
  return (
    <section className="ops-panel">
      <h2>{copy.quick}</h2>
      <nav className="ops-quick" aria-label={copy.quick}>
        {[
          {
            href: "/operations/catalog",
            title: copy.catalog,
            note: copy.catalogNote,
            icon: "catalog" as const,
          },
          {
            href: "/operations/customers",
            title: copy.customers,
            note: copy.customersNote,
            icon: "customers" as const,
          },
          {
            href: "/operations/orders",
            title: copy.orders,
            note: copy.ordersNote,
            icon: "orders" as const,
          },
        ].map((item) => (
          <Link key={item.href} href={item.href} prefetch={false}>
            <OperationsIcon name={item.icon} />
            <span>
              <strong>{item.title}</strong>
              <small>{item.note}</small>
            </span>
            <OperationsIcon name="arrow" />
          </Link>
        ))}
      </nav>
    </section>
  );
}
