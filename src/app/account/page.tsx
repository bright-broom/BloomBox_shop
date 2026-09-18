import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadCustomerPortal } from "@/shared/infrastructure/customer-portal";
import { loadCustomerAccount } from "@/shared/infrastructure/customer-account";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { CustomerAccountPanel } from "@/ui/customer-account";
import { startCustomerLogin, endCustomerLogin } from "./actions";
import { requireMembershipAgreement } from "./membership-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ after?: string | string[]; error?: string | string[]; welcome?: string | string[] }> }) {
  const params = await searchParams;
  await requireMembershipAgreement("/account");
  const state = await loadCustomerAccount(params.after);
  const portal = state.status === "ready" ? await loadCustomerPortal() : null;
  const display = state.status === "ready" && portal?.status === "ready" && portal.snapshot.preferences.name
    ? { ...state, account: { ...state.account, name: portal.snapshot.preferences.name } } : state;
  if (state.status === "disabled" || state.status === "signed-out" || state.status === "expired") redirect("/account/login");
  const controls = state.status === "ready" ? <form action={endCustomerLogin}><button className="secondary-button" type="submit">{copy.signOut}</button></form>
    : <form action={startCustomerLogin}><button className="primary-button" type="submit">{copy.signIn}</button></form>;
  const panel = <CustomerAccountPanel state={display} controls={controls} loginError={Boolean(params.error)} hasPreviousPage={Boolean(params.after)} />;
  return state.status === "ready" && params.welcome === "1" ? <>
    <p role="status" className="account-notice section-shell">{copy.welcome.completed}</p>{panel}
  </> : panel;
}
