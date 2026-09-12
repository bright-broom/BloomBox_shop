import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { loadCheckoutProviderMode } from "@/shared/infrastructure/config/checkout-provider-config";
import { referralContent as copy, referralCopy } from "@/shared/infrastructure/content/referral-content";
import { ReferralPanel } from "@/ui/referral-panel";
import { TestModeBanner } from "@/ui/preview-checkout-shared";

export const metadata: Metadata = { title: "友人紹介（Test Mode）", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  if (loadRuntimeMode() !== "preview" || loadCheckoutProviderMode() !== "preview") notFound();
  const query = await searchParams;
  const code = typeof query.code === "string" && /^BB-[A-F0-9]{24}$/.test(query.code) ? query.code : "";
  return (
    <section className="section-shell referral-page">
      <header className="checkout-header">
        <p className="eyebrow">SHARE THE JOY</p>
        <h1>{copy.title}</h1><p>{copy.lead}</p>
      </header>
      <TestModeBanner>{copy.previewNotice}</TestModeBanner>
      <div className="referral-benefits">
        <h2>{referralCopy(copy.friendBenefit)}</h2><h2>{referralCopy(copy.referrerBenefit)}</h2>
      </div>
      <p className="field-note">{referralCopy(copy.terms)}</p>
      <ReferralPanel initialCode={code} />
    </section>
  );
}
