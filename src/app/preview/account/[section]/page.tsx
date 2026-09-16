import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import { notFound } from "next/navigation";
import {
  emptyAccountPreferences,
  type PortalSnapshot,
} from "@/modules/customer/public";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { application } from "@/shared/infrastructure/composition-root";
import {
  AccountPortalFrame,
  accountSections,
  ProfileEditor,
  AddressEditor,
  FavoriteEditor,
  AccountSettings,
  AccountSupport,
} from "@/ui/account-portal";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "マイページの機能見本",
  robots: { index: false, follow: false },
};
export default async function Preview({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  if (loadRuntimeMode() !== "preview") notFound();
  const value = (await params).section,
    section = accountSections.find((s) => s === value);
  if (!section) notFound();
  const snapshot: PortalSnapshot = {
    revision: 0,
    preferences: emptyAccountPreferences(),
  };
  const products = await application.listProducts.execute();
  return (
    <AccountPortalFrame section={section} preview>
      {section === "profile" ? (
        <ProfileEditor
          snapshot={snapshot}
          email={copy.sampleEmail}
          googleName={copy.sampleName}
          preview
        />
      ) : null}
      {section === "addresses" ? (
        <AddressEditor snapshot={snapshot} preview />
      ) : null}
      {section === "favorites" ? (
        <FavoriteEditor
          snapshot={snapshot}
          products={[]}
          candidates={products}
          preview
        />
      ) : null}
      {section === "settings" ? (
        <AccountSettings snapshot={snapshot} preview />
      ) : null}
      {section === "support" ? (
        <AccountSupport requests={[]} orders={[]} preview />
      ) : null}
    </AccountPortalFrame>
  );
}
