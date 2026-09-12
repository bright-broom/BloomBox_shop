import type { Metadata } from "next";
import Link from "next/link";
import { loadCustomerAccount } from "@/shared/infrastructure/customer-account";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { CustomerAccountPanel } from "@/ui/customer-account";
import { startCustomerLogin, endCustomerLogin } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ after?: string | string[]; error?: string | string[] }> }) {
  const params = await searchParams;
  const state = await loadCustomerAccount(params.after);
  const controls = state.status === "disabled" ? (loadRuntimeMode() === "preview"
    ? <Link className="text-link" href="/preview/account">{copy.previewLink}</Link> : null)
    : state.status === "ready" ? <form action={endCustomerLogin}><button className="secondary-button" type="submit">{copy.signOut}</button></form>
      : <form action={startCustomerLogin}><button className="primary-button" type="submit">{copy.signIn}<span aria-hidden="true">↗</span></button></form>;
  return <CustomerAccountPanel state={state} controls={controls} loginError={Boolean(params.error)} />;
}
