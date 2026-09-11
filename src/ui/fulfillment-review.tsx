import { fulfillmentReviewSummary, type FulfillmentReview } from "@/modules/fulfillment/public";
import { formatMoney, money } from "@/shared/domain/money";
import { fulfillmentReviewContent as copy } from "@/shared/infrastructure/content/fulfillment-review-content";

const dateTime = (value: string) => new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
}).format(new Date(value));
function Timestamp({ value }: { value: string | null }) {
  return value ? <time dateTime={value}>{dateTime(value)}</time> : <>{copy.unavailable}</>;
}

/** Read-only display of an authorized DTO (or explicitly synthetic preview). Never decides permission to approve. */
export function FulfillmentReviewPanel({ review }: { review: FulfillmentReview }) {
  const summary = fulfillmentReviewSummary(review);
  return <div className="fulfillment-review-grid">
    <div>
      <section className="fulfillment-review-section" aria-labelledby="review-order">
        <p className="eyebrow">01</p><h2 id="review-order">{copy.order}</h2>
        <ul className="fulfillment-review-items">{review.items.map((item, index) => <li key={index}>
          <span>{item.name}</span><strong>{item.quantity} {copy.quantityUnit}</strong>
        </li>)}</ul>
        <dl className="fulfillment-review-facts">
          <div><dt>{copy.delivery}</dt><dd><time dateTime={review.deliveryDate}>{review.deliveryDate.replaceAll("-", "/")}</time></dd></div>
          <div><dt>{copy.total}</dt><dd>{formatMoney(money(review.totalMinor))}</dd></div>
          <div><dt>{copy.orderState}</dt><dd>{copy.orderStates[review.orderStatus]}</dd></div>
          <div><dt>{copy.fulfillmentState}</dt><dd>{copy.fulfillmentStates[review.status]}</dd></div>
          <div><dt>{copy.reference}</dt><dd className="fulfillment-reference">{review.orderId}</dd></div>
          <div><dt>{copy.version}</dt><dd>{review.intakeVersion}</dd></div>
        </dl>
      </section>
      <section className="fulfillment-review-section" aria-labelledby="review-checks">
        <p className="eyebrow">02</p><h2 id="review-checks">{copy.checks}</h2>
        <article className="fulfillment-check"><h3>{copy.payment}</h3>
          <p>{review.paymentEvidenceCurrent ? copy.paymentCurrent : copy.paymentChanged}</p>
          <dl className="fulfillment-review-facts">
            <div><dt>{copy.captured}</dt><dd>{formatMoney(money(review.capturedMinor))}</dd></div>
            <div><dt>{copy.refunded}</dt><dd>{formatMoney(money(review.refundedMinor))}</dd></div>
          </dl>
        </article>
        <article className="fulfillment-check"><h3>{copy.stock}</h3>
          <p>{review.stock.status === "COVERED" ? copy.stockCovered : review.stock.status === "HELD" ? copy.stockHeld : copy.stockUnknown}</p>
          <dl className="fulfillment-review-facts">
            <div><dt>{copy.checkedAt}</dt><dd><Timestamp value={review.stock.checkedAt} /></dd></div>
            <div><dt>{copy.expiresAt}</dt><dd><Timestamp value={review.stock.expiresAt} /></dd></div>
          </dl><p className="form-hint">{copy.stockNote}</p>
        </article>
        <article className="fulfillment-check"><h3>{copy.quantities}</h3>
          <p>{review.quantities.reason === "MATCHED" ? copy.quantityMatched : copy.quantityUnknown}</p>
          <dl className="fulfillment-review-facts">
            <div><dt>{copy.ordered}</dt><dd>{review.quantities.ordered} {copy.quantityUnit}</dd></div>
            <div><dt>{copy.shipped}</dt><dd>{review.quantities.shipped ?? copy.unavailable}</dd></div>
            <div><dt>{copy.delivered}</dt><dd>{review.quantities.delivered ?? copy.unavailable}</dd></div>
          </dl>
        </article>
      </section>
    </div>
    <aside className="fulfillment-review-summary" aria-labelledby="review-approval">
      <p className="eyebrow">03</p><h2 id="review-approval">{copy.approval}</h2>
      <p className="fulfillment-review-state">{summary === "REVIEW_REQUIRED" ? copy.reviewTitle : summary === "RECORDED" ? copy.recordedTitle : copy.pendingTitle}</p>
      <p>{summary === "REVIEW_REQUIRED" ? copy.reviewNote : summary === "RECORDED" ? copy.recordedNote : copy.pendingNote}</p>
      {review.latestApproval ? <div className="fulfillment-approval-history">
        {summary !== "RECORDED" ? <p>{copy.recordedNote}</p> : null}<dl className="fulfillment-review-facts">
          <div><dt>{copy.recordedVersion}</dt><dd>{review.latestApproval.intakeVersion}</dd></div>
          <div><dt>{copy.recordedAt}</dt><dd><Timestamp value={review.latestApproval.recordedAt} /></dd></div>
          <div><dt>{copy.recordExpiresAt}</dt><dd><Timestamp value={review.latestApproval.expiresAt} /></dd></div>
        </dl>
      </div> : null}
      <dl className="fulfillment-review-facts">
        <div><dt>{copy.observedAt}</dt><dd><Timestamp value={review.observedAt} /></dd></div>
        <div><dt>{copy.viewedAt}</dt><dd><Timestamp value={review.viewedAt} /></dd></div>
      </dl>
    </aside>
  </div>;
}
