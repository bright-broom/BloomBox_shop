import type { Metadata } from "next";
import Link from "next/link";
import { requireOperatorLogin } from "@/shared/infrastructure/security/auth-entry";
import {
  openOperatorOrders,
  operatorOrderInput,
} from "@/shared/infrastructure/security/operator-auth/operations-console";
import { consoleResource } from "@/shared/infrastructure/security/operator-auth/console-resource";
import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
import { customerManagementContent as states } from "@/shared/infrastructure/content/customer-management-content";
import { OPERATOR_ORDER_SEARCH_LIMIT } from "@/modules/order/public";
import {
  ConsoleHeader,
  ConsoleState,
  OrdersTable,
} from "@/ui/operations-console";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: copy.orders,
  robots: { index: false, follow: false },
};
export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperatorLogin("/operations/orders");
  const input = await searchParams;
  const parsed = operatorOrderInput.safeParse(input);
  const filters = parsed.success ? parsed.data : {};
  const state = await consoleResource(() => openOperatorOrders(input));
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value && key !== "after") next.set(key, value);
  if (state.status === "ready" && state.value.next)
    next.set("after", state.value.next);
  const selects = [
    {
      name: "status",
      label: copy.orderStatus,
      values: operatorOrderInput.shape.status.unwrap().options,
      labels: states.orderStatuses,
    },
    {
      name: "payment",
      label: copy.payment,
      values: operatorOrderInput.shape.payment.unwrap().options,
      labels: states.paymentStatuses,
    },
    {
      name: "fulfillment",
      label: copy.fulfillment,
      values: operatorOrderInput.shape.fulfillment.unwrap().options,
      labels: states.fulfillmentStatuses,
    },
  ] as const;
  return (
    <>
      <ConsoleHeader title={copy.orders} lead={copy.ordersNote} />
      <form method="get" action="/operations/orders" className="ops-filters">
        <div className="form-field ops-search">
          <label htmlFor="order-query">{copy.reference}</label>
          <input
            id="order-query"
            name="q"
            type="search"
            defaultValue={filters.q ?? ""}
            maxLength={OPERATOR_ORDER_SEARCH_LIMIT}
            autoComplete="off"
            aria-describedby="order-query-hint"
          />
          <p id="order-query-hint" className="ops-caption">
            {copy.referenceHint}
          </p>
        </div>
        {selects.map((field) => (
          <div className="form-field" key={field.name}>
            <label htmlFor={`order-${field.name}`}>{field.label}</label>
            <select
              id={`order-${field.name}`}
              name={field.name}
              defaultValue={filters[field.name] ?? ""}
            >
              {field.values.map((value) => (
                <option key={value} value={value}>
                  {value ? (field.labels[value] ?? copy.unknown) : copy.all}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="ops-filter-actions">
          <button className="primary-button" type="submit">
            {copy.search}
          </button>
          <Link
            className="text-link"
            href="/operations/orders"
            prefetch={false}
          >
            {copy.reset}
          </Link>
        </div>
      </form>
      <section className="ops-panel">
        {state.status === "ready" ? (
          <>
            <OrdersTable page={state.value} />
            <nav className="ops-pagination" aria-label={copy.orders}>
              <Link
                className="text-link"
                href="/operations/orders"
                prefetch={false}
              >
                {copy.first}
              </Link>
              {state.value.next ? (
                <Link
                  className="text-link"
                  href={`/operations/orders?${next}`}
                  prefetch={false}
                >
                  {copy.next}
                </Link>
              ) : null}
            </nav>
          </>
        ) : (
          <ConsoleState status={state.status} />
        )}
      </section>
      <aside className="ops-panel">
        <h2>{copy.shippingTitle}</h2>
        <p>{copy.shippingNote}</p>
      </aside>
    </>
  );
}
