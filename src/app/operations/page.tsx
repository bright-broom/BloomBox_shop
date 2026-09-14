import { catalogManagementContent } from "@/shared/infrastructure/content/catalog-management-content";
import { customerManagementContent } from "@/shared/infrastructure/content/customer-management-content";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadOperatorEntry } from "@/shared/infrastructure/security/auth-entry";
import { operatorLoginContent as copy } from "@/shared/infrastructure/content/operator-login-content";
import { fulfillmentInboxContent } from "@/shared/infrastructure/content/fulfillment-inbox-content";
import { operatorPermissionsContent } from "@/shared/infrastructure/content/operator-permissions-content";
import { endOperatorLogin } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.dashboardTitle, robots: { index: false, follow: false } };
export default async function OperationsPage() {
  const state = await loadOperatorEntry();
  if (state.status !== "ready" || !state.bound) redirect("/operations/login");
  const destinations = [
    { href: "/operations/catalog", title: catalogManagementContent.title, note: copy.catalogNote },
    { href: "/operations/customers", title: customerManagementContent.title, note: copy.customersNote },
    { href: "/operations/fulfillments", title: fulfillmentInboxContent.title, note: copy.fulfillmentsNote },
    { href: "/operations/permissions", title: operatorPermissionsContent.title, note: copy.permissionsNote },
  ];
  return <section className="section-shell content-page">
    <header className="content-header"><p className="eyebrow">BLOOMBOX OPERATIONS</p><h1>{copy.dashboardTitle}</h1><p>{copy.boundNote}</p></header>
    <nav className="operations-destinations" aria-label={copy.dashboardTitle}>{destinations.map((item) => <Link href={item.href} prefetch={false} key={item.href}>
      <h2>{item.title}</h2><p>{item.note}</p><span aria-hidden="true">↗</span></Link>)}</nav>
    <p>{copy.accessNote}</p><form action={endOperatorLogin}><button className="secondary-button" type="submit">{copy.signOut}</button></form>
    <Link className="text-link" href="/">{copy.home}</Link>
  </section>;
}
