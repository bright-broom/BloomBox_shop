import { customerPortalContent as portalCopy } from "@/shared/infrastructure/content/customer-portal-content";
import { PrintOrder } from "./account-portal-form";
import Link from "next/link";
import type { CustomerOrderDetailState } from "@/shared/infrastructure/customer-account";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { formatMoney, money } from "@/shared/domain/money";

export function CustomerOrderDetailPanel({ state, preview = false, retryHref, reorderProducts = [] }: {
  reorderProducts?: readonly { id: string; name: string }[]; state: CustomerOrderDetailState; preview?: boolean; retryHref?: string;
}) {
  const order = state.status === "ready" ? state.order : null;
  return <section className="section-shell account-page">
    <header className="account-heading"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.detail.title}</h1><p>{copy.detail.lead}</p></header>
    {preview ? <aside className="account-notice"><strong>{copy.detail.previewTitle}</strong><p>{copy.previewNote}</p></aside> : null}
    <div className="account-content">
      {!order ? <section><h2>{state.status === "disabled" ? copy.disabledTitle : copy.detail.unavailableTitle}</h2>
        <p role={state.status === "unavailable" ? "alert" : undefined}>{state.status === "disabled" ? copy.disabledNote : state.status === "unavailable" ? copy.detail.error : copy.detail.unavailableNote}</p>
        {state.status === "unavailable" && retryHref ? <Link className="text-link" prefetch={false} href={retryHref}>{copy.retry}</Link> : null}
      </section> : <>
        <section><header className="account-order-heading"><h2>{copy.orderNumber} {order.name}</h2>
          <time dateTime={order.orderedAt}>{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium" }).format(new Date(order.orderedAt))}</time></header>
          {order.cancelled ? <p className="account-status">{copy.cancelled}</p> : null}
          <dl className="account-order-facts">
            <div><dt>{copy.payment}</dt><dd>{Object.hasOwn(copy.payments, order.payment) ? copy.payments[order.payment] : copy.payments.UNKNOWN}</dd></div>
            <div><dt>{copy.fulfillment}</dt><dd>{Object.hasOwn(copy.fulfillments, order.fulfillment) ? copy.fulfillments[order.fulfillment] : copy.fulfillments.UNKNOWN}</dd></div>
          </dl>
        </section>
        <section><h2>{copy.detail.items}</h2><ol className="account-order-list">{order.items.map((item, index) => <li key={index}>
          <h3>{item.name}</h3><dl className="account-order-facts">
            <div><dt>{copy.detail.quantity}</dt><dd>{item.quantity}</dd></div>
            <div><dt>{copy.detail.unitPrice}</dt><dd>{formatMoney(money(item.unitYen))}</dd></div>
            <div><dt>{copy.detail.lineTotal}</dt><dd>{formatMoney(money(item.totalYen))}</dd></div>
          </dl></li>)}</ol>
        </section>
        <section><h2>{copy.total}</h2><dl className="account-order-facts">
          <div><dt>{copy.detail.subtotal}</dt><dd>{formatMoney(money(order.subtotalYen))}</dd></div>
          <div><dt>{copy.detail.shipping}</dt><dd>{formatMoney(money(order.shippingYen))}</dd></div>
          {order.taxYen > 0 ? <div><dt>{copy.detail.tax}</dt><dd>{formatMoney(money(order.taxYen))}</dd></div> : null}
          {order.discountYen > 0 ? <div><dt>{copy.detail.discount}</dt><dd>−{formatMoney(money(order.discountYen))}</dd></div> : null}
          <div><dt>{copy.total}</dt><dd>{formatMoney(money(order.totalYen))}</dd></div>
        </dl><p className="form-hint">{copy.totalNote}</p></section>
        {order.shipment ? <section><h2>{portalCopy.shipping}</h2><dl className="account-order-facts"><div><dt>{portalCopy.tracking}</dt><dd>{order.shipment.carrier} · {order.shipment.trackingNumber}</dd></div><div><dt>{portalCopy.shippedAt}</dt><dd>{new Date(order.shipment.shippedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}</dd></div>{order.shipment.deliveredAt ? <div><dt>{portalCopy.deliveredAt}</dt><dd>{new Date(order.shipment.deliveredAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}</dd></div> : null}</dl></section> : null}
        {order.refunds?.length ? <section><h2>{portalCopy.refunds}</h2><p>{portalCopy.refundNote}</p><ul>{order.refunds.map((refund,index) => <li key={index}>{new Date(refund.createdAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} · {formatMoney(money(refund.amountYen))} · {Object.hasOwn(portalCopy.refundStatuses,refund.status) ? portalCopy.refundStatuses[refund.status as keyof typeof portalCopy.refundStatuses] : copy.payments.UNKNOWN}</li>)}</ul></section> : null}
        <p className="form-hint">{portalCopy.printNote}</p>
        <div className="account-order-actions"><PrintOrder />{!preview ? <Link className="secondary-button" href={'/account/support?order='+encodeURIComponent(order.id)}>{portalCopy.orderHelp}</Link> : null}
          {reorderProducts.length ? reorderProducts.map(product => <Link className="secondary-button" key={product.id} href={'/gift/'+encodeURIComponent(product.id)}>{portalCopy.reorder} · {product.name}</Link>) : <Link className="secondary-button" href="/flowers">{portalCopy.reorder}</Link>}</div><p className="form-hint">{portalCopy.reorderNote}</p>
      </>}
    </div>
    <Link className="text-link" prefetch={false} href={preview ? "/preview/account" : "/account"}>{copy.detail.back}</Link>
  </section>;
}
