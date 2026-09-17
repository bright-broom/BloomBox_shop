import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FULFILLMENT_STATUSES, NativeFulfillmentError } from "@/modules/fulfillment/public";
import { nativeFulfillmentContent as copy } from "@/shared/infrastructure/content/native-fulfillment-content";
import { requireOperatorLogin } from "@/shared/infrastructure/security/auth-entry";
import { readNativeFulfillments } from "@/shared/infrastructure/security/operator-auth/native-fulfillment-management";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
export default async function NativeFulfillments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOperatorLogin("/operations/native-fulfillments");
  const parsed = z.object({ status: z.enum(FULFILLMENT_STATUSES).or(z.literal("")).optional(), after: z.string().max(200).optional() }).strict().safeParse(await searchParams);
  const result = parsed.success ? await load(parsed.data) : { page: null, error: copy.messages.INVALID };
  return <section className="section-shell content-page"><header className="content-header"><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    <form className="catalog-tools"><div className="form-field"><label htmlFor="fulfillment-status">{copy.status}</label><select name="status" id="fulfillment-status" defaultValue={parsed.success ? parsed.data.status ?? "" : ""}><option value="">{copy.all}</option>{FULFILLMENT_STATUSES.map((status) => <option value={status} key={status}>{copy.statuses[status]}</option>)}</select></div><button className="secondary-button">{copy.filter}</button></form>
    {result.error ? <p role="alert">{result.error}</p> : null}
    {result.page ? <>{result.page.items.length ? result.page.items.map((item) => <article className="catalog-management-card" key={item.fulfillmentId}>
      <h2><Link href={`/operations/native-fulfillments/${item.fulfillmentId}`} prefetch={false}>{item.orderDisplayId}</Link></h2><p>{copy.statuses[item.status]}</p><p>{copy.date}：<time dateTime={item.deliveryDate}>{item.deliveryDate}</time></p>
      <ul>{item.items.map((product, index) => <li key={index}>{product.name} × {product.quantity}</li>)}</ul>
      <Link className="text-link" href={`/operations/native-fulfillments/${item.fulfillmentId}`} prefetch={false}>{copy.detail}</Link>
    </article>) : <p>{copy.empty}</p>}
      <nav className="fulfillment-inbox-navigation" aria-label={copy.title}><Link className="text-link" href="/operations/native-fulfillments" prefetch={false}>{copy.first}</Link>{result.page.next ? <Link className="text-link" prefetch={false} href={`/operations/native-fulfillments?${new URLSearchParams({ after: result.page.next, ...(parsed.success && parsed.data.status ? { status: parsed.data.status } : {}) })}`}>{copy.next}</Link> : null}</nav>
    </> : null}
  </section>;
}
async function load(input: { status?: typeof FULFILLMENT_STATUSES[number] | ""; after?: string }) {
  try { return { page: await readNativeFulfillments({ status: input.status || null, after: input.after ?? null }), error: null }; }
  catch (error) {
    if (error instanceof NativeFulfillmentError) {
      if (error.code === "DENIED") notFound();
      if (error.code === "INVALID") return { page: null, error: copy.messages.INVALID };
    }
    console.error("native_fulfillment_list_unavailable");
    return { page: null, error: copy.messages.UNAVAILABLE };
  }
}
