import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadOperatorEntry } from "@/shared/infrastructure/security/auth-entry";
import { loginDestination } from "@/shared/domain/auth-navigation";
import { operatorLoginContent as copy } from "@/shared/infrastructure/content/operator-login-content";
import { startOperatorLogin, endOperatorLogin } from "../actions";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
export default async function OperatorLogin({ searchParams }: { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> }) {
  const params = await searchParams;
  const next = loginDestination(params.next, "operator");
  const state = await loadOperatorEntry();
  if (state.status === "ready" && state.bound) redirect(next);
  return <section className="section-shell login-page">
    <header><p className="eyebrow">BLOOMBOX OPERATIONS</p><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    <div className="login-card">
      {state.status === "disabled" ? <><h2>{copy.disabledTitle}</h2><p>{copy.disabledNote}</p></>
        : state.status === "unavailable" ? <p role="alert">{copy.unavailable}</p>
          : state.status === "ready" ? <><h2>{copy.signedInTitle}</h2><p>{copy.unboundNote}</p>
            <details><summary>{copy.registration}</summary><p>{copy.registrationNote}</p><code>{state.subject}</code></details>
            <form action={endOperatorLogin}><button className="secondary-button" type="submit">{copy.signOut}</button></form></>
            : <><h2>{copy.signIn}</h2><p>{copy.accessNote}</p><form action={startOperatorLogin}>
              <input type="hidden" name="next" value={next}/><button className="primary-button" type="submit">{copy.signIn}</button></form>
              {params.error ? <p role="alert">{copy.error}</p> : null}</>}
      {state.status === "unavailable" ? <Link className="text-link" prefetch={false} href="/operations/login">{copy.retry}</Link> : null}
    </div>
    <nav className="login-links" aria-label={copy.otherEntry}><Link className="text-link" href="/">{copy.home}</Link>
      <Link className="text-link" prefetch={false} href="/account/login">{copy.customerEntry}</Link></nav>
  </section>;
}
