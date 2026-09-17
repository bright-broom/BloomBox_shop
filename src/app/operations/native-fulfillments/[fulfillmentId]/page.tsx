import Link from "next/link";
import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { NativeFulfillmentError } from "@/modules/fulfillment/public";
import { nativeFulfillmentContent as copy } from "@/shared/infrastructure/content/native-fulfillment-content";
import { customerManagementContent as states } from "@/shared/infrastructure/content/customer-management-content";
import { requireOperatorLogin } from "@/shared/infrastructure/security/auth-entry";
import { readNativeFulfillment } from "@/shared/infrastructure/security/operator-auth/native-fulfillment-management";
import { NativeFulfillmentForm } from "@/ui/native-fulfillment-form";
import { saveNativeFulfillment } from "../actions";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
const date = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export default async function NativeFulfillmentDetail({ params }: { params: Promise<{ fulfillmentId: string }> }) {
  const { fulfillmentId } = await params;
  await requireOperatorLogin(`/operations/native-fulfillments/${fulfillmentId}`);
  const result = await load(fulfillmentId);
  const detail = result.detail;
  return <section className="section-shell content-page"><header className="content-header"><h1>{copy.title}{detail ? ` — ${detail.orderDisplayId}` : ""}</h1><p>{copy.lead}</p></header>
    <Link className="text-link" href="/operations/native-fulfillments" prefetch={false}>{copy.back}</Link>
    {result.error ? <p role="alert">{result.error}</p> : null}
    {detail ? <><section className="catalog-management-card"><h2>{copy.items}</h2><ul>{detail.items.map((item, index) => <li key={index}>{item.name} × {item.quantity}</li>)}</ul>
      <dl><dt>{copy.date}</dt><dd><time dateTime={detail.deliveryDate}>{detail.deliveryDate}</time></dd><dt>{copy.status}</dt><dd>{copy.statuses[detail.status]}</dd>
        <dt>{copy.order}</dt><dd>{states.orderStatuses[detail.orderStatus]}</dd><dt>{copy.payment}</dt><dd>{states.paymentStatuses[detail.paymentStatus] ?? states.unknown}</dd></dl>
    </section><section className="catalog-management-card"><h2>{copy.destination}</h2><p className="field-note">{copy.privacy}</p>{detail.destination ? <address className="account-wrap">{detail.destination.name}<br />{detail.destination.postalCode}<br />{detail.destination.prefecture}{detail.destination.city}{detail.destination.line1}<br />{detail.destination.line2}</address> : <p role="alert">{copy.destinationMissing}</p>}</section>
      {detail.shipment ? <section className="catalog-management-card"><h2>{copy.shipment}</h2><dl className="account-wrap"><dt>{copy.carrier}</dt><dd>{copy.carriers[detail.shipment.carrier]}</dd><dt>{copy.tracking}</dt><dd>{detail.shipment.trackingNumber}</dd><dt>{copy.shippedAt}</dt><dd>{date(detail.shipment.shippedAt)}</dd><dt>{copy.deliveredAt}</dt><dd>{detail.shipment.deliveredAt ? date(detail.shipment.deliveredAt) : copy.notRecorded}</dd></dl></section> : null}
      <section className="catalog-management-card"><NativeFulfillmentForm detail={{ fulfillmentId: detail.fulfillmentId, version: detail.version, shipment: detail.shipment }} requestId={randomUUID()} action={saveNativeFulfillment} /></section>
      <section className="catalog-management-card"><h2>{copy.history}</h2>{detail.history.length ? <ol>{detail.history.map((entry) => <li key={entry.version}><p><time dateTime={entry.occurredAt}>{date(entry.occurredAt)}</time> · {copy.actions[entry.action]} · {copy.statuses[entry.fromStatus]} → {copy.statuses[entry.toStatus]}</p><p className="field-note">{copy.operator}：{entry.operatorId} · {copy.version}：{entry.version}</p></li>)}</ol> : <p>{copy.noHistory}</p>}</section>
    </> : null}
  </section>;
}
async function load(id: string) {
  let detail;
  try { detail = await readNativeFulfillment(id); }
  catch (error) {
    if (error instanceof NativeFulfillmentError && ["DENIED", "NOT_FOUND", "INVALID"].includes(error.code)) notFound();
    console.error("native_fulfillment_read_unavailable");
    return { detail: null, error: copy.messages.UNAVAILABLE };
  }
  if (!detail) notFound();
  return { detail, error: null };
}
