import Link from "next/link";
import type { FulfillmentInbox } from "@/modules/fulfillment/public";
import { formatMoney, money } from "@/shared/domain/money";
import { fulfillmentInboxContent as copy } from "@/shared/infrastructure/content/fulfillment-inbox-content";
import { fulfillmentReviewContent } from "@/shared/infrastructure/content/fulfillment-review-content";

export function FulfillmentInboxList({ inbox }: { inbox: FulfillmentInbox }) {
  const firstUrl = `/operations/fulfillments?${new URLSearchParams({ shop: inbox.shop })}`;
  return <section className="fulfillment-inbox-results" aria-label={copy.title}>
    <h2>{inbox.shop}</h2>
    <p>{inbox.testMode ? copy.testMode : copy.liveMode}</p>
    <p className="form-hint">{copy.listNote}</p>
    {inbox.entries.length === 0 ? <p role="status">{copy.empty}</p> : <ol className="fulfillment-inbox-list">
      {inbox.entries.map((entry) => <li key={entry.fulfillmentId}>
        <Link className="fulfillment-inbox-entry" prefetch={false}
          href={`/operations/fulfillments/${encodeURIComponent(inbox.shop)}/${encodeURIComponent(entry.fulfillmentId)}`}>
          <h3>{copy.order} {entry.reference}</h3>
          <dl className="fulfillment-inbox-facts">
            <div><dt>{copy.delivery}</dt><dd><time dateTime={entry.deliveryDate}>{entry.deliveryDate.replaceAll("-", "/")}</time></dd></div>
            <div><dt>{copy.total}</dt><dd>{formatMoney(money(entry.totalMinor))}</dd></div>
            <div><dt>{copy.status}</dt><dd>{fulfillmentReviewContent.fulfillmentStates[entry.status]}</dd></div>
          </dl>
          <span>{copy.detail} <span aria-hidden="true">↗</span></span>
        </Link>
      </li>)}
    </ol>}
    <nav className="fulfillment-inbox-navigation" aria-label={copy.title}>
      <Link className="text-link" prefetch={false} href={firstUrl}>{copy.first}</Link>
      {inbox.nextCursor ? <Link className="secondary-button" prefetch={false}
        href={`/operations/fulfillments?${new URLSearchParams({ shop: inbox.shop, cursor: inbox.nextCursor })}`}>{copy.next}</Link> : null}
    </nav>
    <p className="form-hint">{copy.viewedAt}：<time dateTime={inbox.viewedAt}>{new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "medium",
    }).format(new Date(inbox.viewedAt))}</time></p>
  </section>;
}
