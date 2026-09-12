import type { ReactNode } from "react";
import Link from "next/link";
import type { CustomerAccountState } from "@/shared/infrastructure/customer-account";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { formatMoney, money } from "@/shared/domain/money";

export function CustomerAccountPanel({ state, controls, loginError = false, preview = false }: {
  state: CustomerAccountState; controls?: ReactNode; loginError?: boolean; preview?: boolean;
}) {
  return <section className="section-shell account-page">
    <header className="account-heading"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    {preview ? <aside className="account-notice"><strong>{copy.previewTitle}</strong><p>{copy.previewNote}</p></aside> : null}
    <div className="account-layout">
      <nav className="account-navigation" aria-label={copy.title}>
        <a href="#account-orders">{copy.ordersTitle}</a><a href="#account-profile">{copy.profileTitle}</a><a href="#account-support">{copy.support}</a>
      </nav>
      <div className="account-content">
        {state.status !== "ready" ? <section className="account-welcome" id="account-orders">
          <h2>{state.status === "disabled" ? copy.disabledTitle : copy.loginTitle}</h2>
          <p>{state.status === "disabled" ? copy.disabledNote : copy.loginNote}</p>
          {state.status === "unavailable" || state.status === "expired" || loginError
            ? <p role="alert" className="form-error">{state.status === "unavailable" ? copy.error : state.status === "expired" ? copy.expired : copy.loginError}</p> : null}
          {controls}
          {state.status === "unavailable" ? <Link className="text-link" href="/account" prefetch={false}>{copy.retry}</Link> : null}
          {state.status === "disabled" && preview ? <Link className="text-link" href="/preview/account">{copy.previewLink}</Link> : null}
        </section> : <section id="account-orders" className="account-orders">
          <header><h2>{copy.ordersTitle}</h2><p>{copy.ordersNote}</p></header>
          {state.account.orders.length === 0 ? <div className="account-empty"><h3>{copy.emptyTitle}</h3><p>{copy.emptyNote}</p>
            <Link className="primary-button" href="/flowers">{copy.browse}<span aria-hidden="true">↗</span></Link></div>
            : <><ol className="account-order-list">{state.account.orders.map((order) => <li key={order.id}>
              <div className="account-order-heading"><h3>{copy.orderNumber} {order.name}</h3>
                <time dateTime={order.orderedAt}>{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium" }).format(new Date(order.orderedAt))}</time></div>
              {order.cancelled ? <p className="account-status">{copy.cancelled}</p> : null}
              <dl className="account-order-facts"><div><dt>{copy.total}</dt><dd>{formatMoney(money(order.totalYen))}</dd></div>
                <div><dt>{copy.payment}</dt><dd>{Object.hasOwn(copy.payments, order.payment) ? copy.payments[order.payment] : copy.payments.UNKNOWN}</dd></div>
                <div><dt>{copy.fulfillment}</dt><dd>{Object.hasOwn(copy.fulfillments, order.fulfillment) ? copy.fulfillments[order.fulfillment] : copy.fulfillments.UNKNOWN}</dd></div></dl>
            </li>)}</ol><p className="form-hint">{copy.totalNote}</p></>}
          {!preview ? <nav className="account-pagination" aria-label={copy.ordersTitle}>
            <Link className="text-link" href="/account" prefetch={false}>{copy.first}</Link>
            {state.account.nextCursor ? <Link className="secondary-button" prefetch={false}
              href={`/account?after=${encodeURIComponent(state.account.nextCursor)}`}>{copy.next}</Link> : null}</nav> : null}
        </section>}
        <section id="account-profile" className="account-profile"><h2>{copy.profileTitle}</h2>
          {state.status === "ready" ? <><dl><div><dt>{copy.name}</dt><dd>{state.account.name || copy.notRegistered}</dd></div>
            <div><dt>{copy.email}</dt><dd>{state.account.email ?? copy.notRegistered}</dd></div></dl><p>{copy.profileNote}</p>{controls}
            <p className="form-hint">{copy.sessionNote}</p></> : <p>{copy.loginNote}</p>}
        </section>
        <section id="account-support" className="account-support"><h2>{copy.support}</h2><p>{copy.supportNote}</p>
          <Link className="text-link" href="/contact">{copy.contact}<span aria-hidden="true">↗</span></Link></section>
      </div>
    </div>
  </section>;
}
