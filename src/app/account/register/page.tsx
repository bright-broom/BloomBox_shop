import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadCustomerEntry } from "@/shared/infrastructure/security/auth-entry";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { startCustomerRegistration } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.registration.title, robots: { index: false, follow: false } };
export default async function CustomerRegistration({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const params = await searchParams;
  const state = await loadCustomerEntry();
  // A signed-in customer continues to My Page, which asks for the agreement when it is still missing.
  if (state.status === "ready") redirect("/account");
  const registration = copy.registration;
  return <section className="section-shell login-page">
    <header><p className="eyebrow">{registration.eyebrow}</p><h1>{registration.title}</h1><p>{registration.lead}</p></header>
    <div className="login-card">
      <ul>{registration.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul>
      <h2>{registration.stepsLabel}</h2>
      <ol className="registration-steps">{registration.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <p>{registration.dataNote}</p>
      {state.status === "disabled" ? <p className="account-notice">{copy.disabledNote}</p>
        : state.status === "unavailable" ? <p role="alert" className="form-error">{copy.error}</p>
          : <><form action={startCustomerRegistration}>
            <button className="primary-button" type="submit">{registration.action}<span aria-hidden="true">↗</span></button></form>
            {params.error ? <p role="alert" className="form-error">{copy.loginError}</p> : null}</>}
      {state.status === "unavailable" ? <Link className="text-link" prefetch={false} href="/account/register">{copy.retry}</Link> : null}
    </div>
    <nav className="login-links" aria-label={copy.entry.otherEntry}>
      <p>{registration.memberPrompt} <Link className="text-link" prefetch={false} href="/account/login">{registration.loginLink}</Link></p>
      <Link className="text-link" href="/">{copy.entry.home}</Link>
    </nav>
  </section>;
}
