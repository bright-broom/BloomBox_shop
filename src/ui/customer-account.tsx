import { CustomerLoyaltyPanel } from "./customer-loyalty";
import type { ReactNode } from "react";
import Link from "next/link";
import type { CustomerAccountState } from "@/shared/infrastructure/customer-account";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { formatMoney, money } from "@/shared/domain/money";
import { AccountIcon } from "./account-icon";

export function CustomerAccountPanel({ state, controls, loginError = false, preview = false, hasPreviousPage = false }: {
  state: CustomerAccountState; controls?: ReactNode; loginError?: boolean; preview?: boolean; hasPreviousPage?: boolean;
}) {
  return <section className="section-shell account-page account-dashboard">
    <header className="account-heading"><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1></div>
      <Link className="secondary-button" href="/flowers"><AccountIcon name="flower" />{copy.browse}<AccountIcon name="arrow" /></Link></header>
    {preview ? <aside className="account-notice"><strong>{copy.previewTitle}</strong><p>{copy.previewNote}</p></aside> : null}
    <div className="account-layout">
      <nav className="account-navigation" aria-label={copy.title}>
        {state.status === "ready" && state.loyalty ? <a href="#account-loyalty"><AccountIcon name="gift" />{copy.loyalty.navigation}</a> : null}
        <a href="#account-orders"><AccountIcon name="truck" />{copy.ordersTitle}</a><a href="#account-profile"><AccountIcon name="user" />{copy.profileTitle}</a><a href="#account-support"><AccountIcon name="help" />{copy.contact}</a>
      </nav>
      <div className={`account-content${state.status === "ready" && state.loyalty ? "" : " account-content-no-loyalty"}`}>
        {state.status === "ready" && state.loyalty ? <CustomerLoyaltyPanel state={state.loyalty} /> : null}
        {state.status !== "ready" ? <section className="account-welcome" id="account-orders">
          <h2>{state.status === "disabled" ? copy.disabledTitle : copy.loginTitle}</h2>
          <p>{state.status === "disabled" ? copy.disabledNote : copy.loginNote}</p>
          {state.status === "unavailable" || state.status === "expired" || loginError
            ? <p role="alert" className="form-error">{state.status === "unavailable" ? copy.error : state.status === "expired" ? copy.expired : copy.loginError}</p> : null}
          {controls}
          {state.status === "unavailable" ? <Link className="text-link" href="/account" prefetch={false}>{copy.retry}</Link> : null}
          {state.status === "disabled" && preview ? <Link className="text-link" href="/preview/account">{copy.previewLink}</Link> : null}
        </section> : <section id="account-orders" className="account-orders">
          <header className="account-section-heading"><h2><AccountIcon name="gift" />{copy.ordersTitle}</h2></header>
          {state.account.orders.length === 0 ? <div className="account-empty"><span className="account-empty-icon"><AccountIcon name="gift" /></span><div><h3>{copy.emptyTitle}</h3><p>{copy.emptyNote}</p></div>
            <Link className="primary-button" href="/flowers">{copy.browse}<AccountIcon name="arrow" /></Link></div>
            : <><ol className="account-order-list">{state.account.orders.map((order) => <li key={order.id}>
              <div className="account-order-heading"><h3><span className="visually-hidden">{copy.orderNumber} </span>{order.name}</h3>
                <time dateTime={order.orderedAt}>{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium" }).format(new Date(order.orderedAt))}</time></div>
              {order.items?.length ? <ul className="account-order-products">{order.items.map((item, index) => <li key={index}>{item.name} × {item.quantity}</li>)}</ul> : null}
              {order.cancelled ? <p className="account-status">{copy.cancelled}</p> : null}
              <dl className="account-order-facts"><div><dt>{copy.total}</dt><dd>{formatMoney(money(order.totalYen))}</dd></div>
                <div><dt><AccountIcon name="card" /><span className="visually-hidden">{copy.payment}</span></dt><dd>{Object.hasOwn(copy.payments, order.payment) ? copy.payments[order.payment] : copy.payments.UNKNOWN}</dd></div>
                <div><dt><AccountIcon name="truck" /><span className="visually-hidden">{copy.fulfillment}</span></dt><dd>{Object.hasOwn(copy.fulfillments, order.fulfillment) ? copy.fulfillments[order.fulfillment] : copy.fulfillments.UNKNOWN}</dd></div></dl>
              <Link className="account-icon-button account-order-open" prefetch={false} aria-label={`${copy.detail.open} ${order.name}`} title={copy.detail.open}
                href={preview ? `/preview/account/order?sample=${encodeURIComponent(order.id)}` : `/account/orders/${encodeURIComponent(order.id)}`}><AccountIcon name="arrow" /></Link>
            </li>)}</ol><p className="form-hint">{copy.totalNote}</p></>}
          {!preview && (state.account.orders.length > 0 || hasPreviousPage) ? <nav className="account-pagination" aria-label={copy.ordersTitle}>
            <Link className="text-link" href="/account" prefetch={false}>{copy.first}</Link>
            {state.account.nextCursor ? <Link className="secondary-button" prefetch={false}
              href={`/account?after=${encodeURIComponent(state.account.nextCursor)}`}>{copy.next}</Link> : null}</nav> : null}
        </section>}
        <aside className="account-aside" aria-label={copy.profileTitle}>
        <section id="account-profile" className="account-profile"><h2><AccountIcon name="user" />{copy.profileTitle}</h2>
          {state.status === "ready" ? <><dl><div><dt><AccountIcon name="user" /><span className="visually-hidden">{copy.name}</span></dt><dd>{state.account.name || copy.notRegistered}</dd></div>
            <div><dt><AccountIcon name="mail" /><span className="visually-hidden">{copy.email}</span></dt><dd>{state.account.email ?? copy.notRegistered}</dd></div></dl>
            <div className="account-session"><AccountIcon name="logout" />{controls}</div>
            <details className="account-profile-help"><summary><AccountIcon name="info" /><span>{copy.profileHelp}</span><AccountIcon name="chevron" /></summary><p>{copy.profileNote}</p><p>{copy.sessionNote}</p></details></> : <p>{copy.loginNote}</p>}
        </section>
        <section id="account-support" className="account-support"><Link href="/contact"><span className="account-support-icon"><AccountIcon name="help" /></span><span><strong>{copy.contact}</strong><small>{copy.supportNote}</small></span><AccountIcon name="arrow" /></Link></section>
        </aside>
      </div>
    </div>
  </section>;
}
