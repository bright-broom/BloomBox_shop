import { requireOperatorLogin } from "@/shared/infrastructure/security/auth-entry";
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerManagementError } from '@/modules/customer/public';
import { customerManagementContent as copy } from '@/shared/infrastructure/content/customer-management-content';
import { openCustomerDirectory, directoryInputSchema } from '@/shared/infrastructure/security/operator-auth/customer-management';
import { CustomerDirectoryPanel } from '@/ui/customer-management';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
export default async function Customers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOperatorLogin("/operations/customers");
  const input = await searchParams;
  let page;
  let error;
  try { page = await openCustomerDirectory(input); }
  catch (cause) {
    if (cause instanceof CustomerManagementError && cause.code === 'DENIED') notFound();
    error = cause instanceof CustomerManagementError && cause.code === 'INVALID' ? copy.messages.INVALID : copy.messages.UNAVAILABLE;
    if (error === copy.messages.UNAVAILABLE) console.error('customer_management_unavailable');
  }
  const parsed = directoryInputSchema.safeParse(input);
  return <section className="section-shell content-page customer-management-page">
    <header className="content-header"><p className="eyebrow">BLOOMBOX OPERATIONS</p><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    <CustomerDirectoryPanel page={page} error={error} filters={parsed.success ? parsed.data : {}} />
    <p>{copy.scope}</p><Link className="text-link" prefetch={false} href="/operations">{copy.login}</Link>
  </section>;
}
