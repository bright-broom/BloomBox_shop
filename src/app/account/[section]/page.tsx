import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { productId } from "@/modules/catalog/public";
import { loginHref } from "@/shared/domain/auth-navigation";
import {
  loadCustomerPortal,
  loadCustomerRequests,
} from "@/shared/infrastructure/customer-portal";
import {
  loadCustomerAccount,
  loadCustomerOrderDetail,
} from "@/shared/infrastructure/customer-account";
import { application } from "@/shared/infrastructure/composition-root";
import { customerPortalContent as copy } from "@/shared/infrastructure/content/customer-portal-content";
import {
  AccountPortalFrame,
  accountSections,
  type AccountSection,
  ProfileEditor,
  AddressEditor,
  FavoriteEditor,
  AccountSettings,
  AccountSupport,
} from "@/ui/account-portal";
import {
  saveAccountPreferences,
  sendAccountRequest,
  endAllCustomerSessions,
} from "../portal-actions";
import { requireMembershipAgreement } from "../membership-gate";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "マイページ",
  robots: { index: false, follow: false },
};
export default async function AccountSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ order?: string | string[]; add?: string | string[] }>;
}) {
  const { section: value } = await params;
  if (!accountSections.some((s) => s === value)) notFound();
  const section = value as AccountSection;
  await requireMembershipAgreement("/account/" + section);
  const state = await loadCustomerPortal();
  if (state.status === "signed-out")
    redirect(loginHref("customer", "/account/" + section));
  if (state.status !== "ready")
    return (
      <AccountPortalFrame section={section}>
        <p role="alert">{copy.unavailable}</p>
        <Link className="text-link" href={"/account/" + section}>
          {copy.retry}
        </Link>
      </AccountPortalFrame>
    );
  const { snapshot } = state;
  let content;
  if (section === "profile")
    content = (
      <ProfileEditor
        snapshot={snapshot}
        email={state.email}
        googleName={state.googleName}
        action={saveAccountPreferences}
      />
    );
  if (section === "addresses")
    content = (
      <AddressEditor snapshot={snapshot} action={saveAccountPreferences} />
    );
  if (section === "settings")
    content = (
      <AccountSettings
        snapshot={snapshot}
        action={saveAccountPreferences}
        sessionAction={endAllCustomerSessions}
      />
    );
  if (section === "favorites") {
    const [products, candidates] = await Promise.all([
      Promise.all(
        snapshot.preferences.favorites.map((id) =>
          application.getProduct.byId(productId(id)),
        ),
      ),
      application.listProducts.execute(),
    ]);
    const { add } = await searchParams;
    const sorted = [...candidates].sort(
      (a, b) => Number(b.id === add) - Number(a.id === add),
    );
    content = (
      <FavoriteEditor
        snapshot={snapshot}
        products={products}
        candidates={sorted}
        action={saveAccountPreferences}
      />
    );
  }
  if (section === "support") {
    const { order } = await searchParams;
    const [requests, account, detail] = await Promise.all([
      loadCustomerRequests(),
      loadCustomerAccount(undefined),
      typeof order === "string" ? loadCustomerOrderDetail(order) : null,
    ]);
    if (account.status !== "ready" || detail?.status === "unavailable")
      return (
        <AccountPortalFrame section={section}>
          <p role="alert">{copy.unavailable}</p>
        </AccountPortalFrame>
      );
    const orders = [...account.account.orders];
    if (
      detail?.status === "ready" &&
      !orders.some((o) => o.id === detail.order.id)
    )
      orders.unshift(detail.order);
    content = (
      <AccountSupport
        requests={requests}
        orders={orders}
        selectedOrder={detail?.status === "ready" ? detail.order.id : undefined}
        action={sendAccountRequest}
      />
    );
  }
  return <AccountPortalFrame section={section}>{content}</AccountPortalFrame>;
}
