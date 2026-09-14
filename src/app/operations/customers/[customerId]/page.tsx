import { requireOperatorLogin } from "@/shared/infrastructure/security/auth-entry";
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerManagementError } from '@/modules/customer/public';
import { customerManagementContent as copy } from '@/shared/infrastructure/content/customer-management-content';
import { openCustomerHistory } from '@/shared/infrastructure/security/operator-auth/customer-management';
import { CustomerHistoryPanel } from '@/ui/customer-management';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.historyTitle, robots: { index: false, follow: false } };
export default async function CustomerHistory({ params, searchParams }: {
  params: Promise<{ customerId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperatorLogin("/operations/customers");
  const { customerId } = await params;
  let page;
  let error;
  try { page = await openCustomerHistory({ ...await searchParams, id: customerId }); }
  catch (cause) {
    if (cause instanceof CustomerManagementError && cause.code === 'DENIED') notFound();
    error = cause instanceof CustomerManagementError && cause.code === 'INVALID' ? copy.messages.INVALID : copy.messages.UNAVAILABLE;
    if (error === copy.messages.UNAVAILABLE) console.error('customer_management_unavailable');
  }
  if (page === null) notFound();
  return <section className="section-shell content-page customer-management-page">
    <header className="content-header"><p className="eyebrow">BLOOMBOX OPERATIONS</p><h1>{copy.historyTitle}</h1><p>{copy.historyLead}</p></header>
    {error ? <p role="alert">{error}</p> : null}
    {page ? <CustomerHistoryPanel page={page} /> : null}
    <Link className="text-link" prefetch={false} href="/operations/customers">{copy.back}</Link>
  </section>;
}
