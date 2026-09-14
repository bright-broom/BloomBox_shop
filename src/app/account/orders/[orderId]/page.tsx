import type { Metadata } from "next";
import { loginHref } from "@/shared/domain/auth-navigation";
import { redirect, notFound } from "next/navigation";
import { loadCustomerOrderDetail } from "@/shared/infrastructure/customer-account";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { CustomerOrderDetailPanel } from "@/ui/customer-order-detail";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.detail.title, robots: { index: false, follow: false } };
export default async function CustomerOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const state = await loadCustomerOrderDetail(orderId);
  if (state.status === "disabled" || state.status === "signed-out") redirect(loginHref("customer", `/account/orders/${orderId}`));
  if (state.status === "not-found") notFound();
  return <CustomerOrderDetailPanel state={state} retryHref={`/account/orders/${encodeURIComponent(orderId)}`} />;
}
