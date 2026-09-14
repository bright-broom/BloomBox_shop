import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadCustomerEntry } from "@/shared/infrastructure/security/auth-entry";
import { loginDestination } from "@/shared/domain/auth-navigation";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { startCustomerLogin } from "../actions";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.entry.title, robots: { index: false, follow: false } };
export default async function CustomerLogin({ searchParams }: { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> }) {
  const params = await searchParams;
  const next = loginDestination(params.next, "customer");
  const state = await loadCustomerEntry();
  if (state.status === "ready") redirect(next);
  return <section className="section-shell login-page">
    <header><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.entry.title}</h1><p>{copy.entry.lead}</p></header>
    <div className="login-card"><h2>{copy.loginTitle}</h2><p>{copy.loginNote}</p>
      <ul>{copy.entry.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul>
      {state.status === "disabled" ? <p className="account-notice">{copy.disabledNote}</p>
        : state.status === "unavailable" ? <p role="alert" className="form-error">{copy.error}</p>
          : <><form action={startCustomerLogin}><input type="hidden" name="next" value={next} />
            <button className="primary-button" type="submit">{copy.signIn}<span aria-hidden="true">↗</span></button></form>
            {params.error ? <p role="alert" className="form-error">{copy.loginError}</p> : null}</>}
      {state.status === "unavailable" ? <Link className="text-link" prefetch={false} href="/account/login">{copy.retry}</Link> : null}
      {loadRuntimeMode() === "preview" ? <aside className="login-preview"><h3>{copy.previewTitle}</h3><p>{copy.previewNote}</p>
        <Link className="secondary-button" prefetch={false} href="/preview/account">{copy.previewLink}</Link></aside> : null}
    </div>
    <nav className="login-links" aria-label={copy.entry.otherEntry}><Link className="text-link" href="/">{copy.entry.home}</Link>
      <Link className="text-link" prefetch={false} href="/operations/login">{copy.entry.operator}</Link></nav>
  </section>;
}
