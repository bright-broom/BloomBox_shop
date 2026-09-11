import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { getOperatorAuth } from "@/shared/infrastructure/security/operator-auth/operator-auth";
import { GoogleFulfillmentOperatorIdentity } from "@/shared/infrastructure/security/operator-auth/google-operator-identity";
import { operatorLoginContent as copy } from "@/shared/infrastructure/content/operator-login-content";
import { fulfillmentInboxContent } from "@/shared/infrastructure/content/fulfillment-inbox-content";
import { startOperatorLogin, endOperatorLogin } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
export default async function OperatorLogin({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  const state = await readLoginState();
  return <section className="section-shell content-page">
    <header className="content-header"><p className="eyebrow">BLOOMBOX OPERATIONS</p><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    <div className="content-sections"><section><h2>{state.enabled ? state.subject ? copy.signedInTitle : copy.signIn : copy.disabledTitle}</h2>
      <div>{error && state.enabled ? <p role="alert">{copy.error}</p> : null}
        {!state.enabled ? <p>{copy.disabledNote}</p> : state.subject ? <>
          <p>{state.bound ? copy.boundNote : copy.unboundNote}</p>
          {state.bound ? <Link className="primary-button" href="/operations/fulfillments">{fulfillmentInboxContent.title}</Link> : null}
          {!state.bound ? <details><summary>{copy.registration}</summary><p>{copy.registrationNote}</p><code>{state.subject}</code></details> : null}
          <form action={endOperatorLogin}><button className="secondary-button" type="submit">{copy.signOut}</button></form>
        </> : <form action={startOperatorLogin}><button className="primary-button" type="submit">{copy.signIn}</button></form>}
      </div></section></div>
    <Link className="text-link" href="/">{copy.home}</Link>
  </section>;
}
async function readLoginState() {
  try {
    const service = getOperatorAuth();
    if (!service) return { enabled: false, subject: null, bound: false };
    const session = await service.auth.auth();
    const identity = new GoogleFulfillmentOperatorIdentity(async () => session, service.config.bindings);
    const subject = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/).safeParse(session?.user?.id);
    return { enabled: true, subject: subject.success ? subject.data : null, bound: (await identity.current()) !== null };
  } catch {
    console.error("operator_login_unavailable");
    return { enabled: false, subject: null, bound: false };
  }
}
