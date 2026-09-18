import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ACCOUNT_HOME, loginDestination, loginHref } from "@/shared/domain/auth-navigation";
import { loadMembershipAgreement } from "@/shared/infrastructure/customer-portal";
import { storefrontContent } from "@/shared/infrastructure/content/storefront-content";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { agreeToMembership, endCustomerLogin } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.registration.title, robots: { index: false, follow: false } };
type WelcomeProps = { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> };
export default async function MembershipWelcome({ searchParams }: WelcomeProps) {
  const params = await searchParams;
  const requested = loginDestination(params.next, "customer");
  const next = requested === `${ACCOUNT_HOME}/welcome` ? ACCOUNT_HOME : requested;
  const state = await loadMembershipAgreement();
  if (state.status === "signed-out") redirect(loginHref("customer", `${ACCOUNT_HOME}/welcome`));
  if (state.status === "ready" && state.agreement.status === "agreed") redirect(next);
  const welcome = copy.welcome;
  const updated = state.status === "ready" && state.agreement.status === "required" && state.agreement.previousVersion !== null;
  const error = params.error === "invalid" ? welcome.required : params.error === "conflict" ? welcome.conflict : params.error ? welcome.error : null;
  return <section className="section-shell login-page">
    <header><p className="eyebrow">{copy.registration.eyebrow}</p><h1>{updated ? welcome.updatedTitle : welcome.title}</h1>
      <p>{updated ? welcome.updatedLead : welcome.lead}</p></header>
    <div className="login-card">
      {state.status === "unavailable" ? <>
        <p role="alert" className="form-error">{copy.error}</p>
        <Link className="text-link" prefetch={false} href="/account/welcome">{copy.retry}</Link>
      </> : <>
        <ul className="agreement-documents">
          <li><Link href="/terms" target="_blank" rel="noopener">{welcome.terms}<span className="visually-hidden">{welcome.newTab}</span></Link></li>
          <li><Link href="/privacy" target="_blank" rel="noopener">{welcome.privacy}<span className="visually-hidden">{welcome.newTab}</span></Link></li>
        </ul>
        {storefrontContent.publicationStatus === "draft" ? <p className="account-notice">{welcome.draftNote}</p> : null}
        {error ? <p role="alert" className="form-error" id="agreement-error">{error}</p> : null}
        <form action={agreeToMembership}>
          <input type="hidden" name="version" value={storefrontContent.agreementVersion} />
          {next !== ACCOUNT_HOME ? <input type="hidden" name="next" value={next} /> : null}
          <label className="account-check">
            <input type="checkbox" name="agree" required aria-describedby={error ? "agreement-error" : undefined} />
            {welcome.agree}
          </label>
          <button className="primary-button" type="submit">{updated ? welcome.updatedSubmit : welcome.submit}</button>
        </form>
        <form action={endCustomerLogin}><button className="text-button" type="submit">{welcome.decline}</button></form>
        <p>{welcome.declineNote}</p>
      </>}
    </div>
  </section>;
}
