import { application } from "@/shared/infrastructure/composition-root";
import { productId } from "@/modules/catalog/public";
import type { Metadata } from "next";
import { loginHref } from "@/shared/domain/auth-navigation";
import { redirect, notFound } from "next/navigation";
import { loadCustomerOrderDetail } from "@/shared/infrastructure/customer-account";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { CustomerOrderDetailPanel } from "@/ui/customer-order-detail";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: copy.detail.title,
  robots: { index: false, follow: false },
};
export default async function CustomerOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const state = await loadCustomerOrderDetail(orderId);
  if (state.status === "disabled" || state.status === "signed-out")
    redirect(loginHref("customer", `/account/orders/${orderId}`));
  if (state.status === "not-found") notFound();
  const products =
    state.status === "ready"
      ? await Promise.allSettled(
          [
            ...new Set(
              state.order.items
                .map((item) => item.productId)
                .filter((id): id is string =>
                  Boolean(id && /^[A-Za-z0-9_-]{1,100}$/.test(id)),
                ),
            ),
          ].map((id) => application.getProduct.byId(productId(id))),
        )
      : [];
  const reorderProducts = products.flatMap((result) =>
    result.status === "fulfilled" && result.value?.available
      ? [{ id: result.value.id, name: result.value.name }]
      : [],
  );
  if (products.some((result) => result.status === "rejected"))
    console.error("customer_reorder_catalog_unavailable");
  return (
    <CustomerOrderDetailPanel
      reorderProducts={reorderProducts}
      state={state}
      retryHref={`/account/orders/${encodeURIComponent(orderId)}`}
    />
  );
}
