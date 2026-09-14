import { requireOperatorLogin } from "@/shared/infrastructure/security/auth-entry";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { FulfillmentReviewError } from "@/modules/fulfillment/public";
import { readOperatorInbox } from "@/shared/infrastructure/security/operator-auth/read-operator-inbox";
import { fulfillmentInboxContent as copy } from "@/shared/infrastructure/content/fulfillment-inbox-content";
import { FulfillmentInboxList } from "@/ui/fulfillment-inbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
type Parameters = { shop?: string | string[]; cursor?: string | string[] };
export default async function OperatorFulfillmentInbox({ searchParams }: { searchParams: Promise<Parameters> }) {
  await requireOperatorLogin("/operations/fulfillments");
  const parameters = await searchParams;
  const state = await loadInbox(parameters);
  const shop = typeof parameters.shop === "string" && parameters.shop.length <= 255 ? parameters.shop : "";
  return <section className="section-shell content-page fulfillment-inbox-page">
    <header className="content-header"><p className="eyebrow">BLOOMBOX OPERATIONS</p><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    <form action="/operations/fulfillments" method="get" className="fulfillment-inbox-search">
      <div className="form-field"><label htmlFor="operator-shop">{copy.shopLabel}</label>
        <input id="operator-shop" name="shop" required defaultValue={shop} placeholder={copy.shopPlaceholder}
          aria-describedby="operator-shop-hint" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <p id="operator-shop-hint" className="form-hint">{copy.shopHint}</p>
      </div>
      <button className="primary-button" type="submit">{copy.search}</button>
    </form>
    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state.inbox ? <FulfillmentInboxList inbox={state.inbox} /> : null}
    <Link className="text-link" href="/operations">{copy.login}</Link>
  </section>;
}
async function loadInbox(parameters: Parameters) {
  if (parameters.shop === undefined && parameters.cursor === undefined) return { inbox: null, error: null };
  const input = z.object({ shop: z.string(), cursor: z.string().optional() }).strict().safeParse(parameters);
  if (!input.success) return { inbox: null, error: copy.invalid };
  try { return { inbox: await readOperatorInbox(input.data), error: null }; }
  catch (error) {
    if (error instanceof FulfillmentReviewError) {
      if (error.code === "INVALID_REQUEST") return { inbox: null, error: copy.invalid };
      if (error.code === "NOT_AUTHORIZED") return { inbox: null, error: copy.denied };
    }
    console.error("operator_inbox_unavailable");
    return { inbox: null, error: copy.unavailable };
  }
}
