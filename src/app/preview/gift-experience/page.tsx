import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { FlowerLoading } from "@/ui/flower-loading";
import { PreviewMetricsPanel } from "@/ui/preview-metrics-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ギフト体験の確認", robots: { index: false, follow: false } };
export default function GiftExperiencePreview() {
  if (loadRuntimeMode() !== "preview") notFound();
  const copy = giftExperienceContent.preview;
  return <section className="section-shell gift-next-page">
    <p className="eyebrow">EXPERIENCE PREVIEW</p><h1>{copy.title}</h1><p>{copy.lead}</p>
    <nav className="referral-actions" aria-label={copy.title}>
      <Link className="primary-button" href="/flowers">{copy.catalogLabel}</Link>
      <Link className="text-link" href="/gift-next">{copy.recipientLabel}</Link>
      <Link className="text-link" href="/referrals">{copy.benefitLabel}</Link>
    </nav>
    <PreviewMetricsPanel />
    <h2>{copy.loadingTitle}</h2><p>{copy.loadingNote}</p><FlowerLoading compact />
  </section>;
}
