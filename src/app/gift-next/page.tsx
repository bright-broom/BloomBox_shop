import type { Metadata } from "next";
import Link from "next/link";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { PreviewMetric } from "@/ui/preview-metric";

export const metadata: Metadata = { title: "花を受け取った方へ", robots: { index: false, follow: false }, referrer: "no-referrer" };

// A generic printed-card destination. Never read an order ID, referral token or customer cookie here.
export default function GiftNextPage() {
  const copy = giftExperienceContent.recipient;
  return <section className="section-shell gift-next-page">
    {loadRuntimeMode() === "preview" ? <PreviewMetric event={{ name: "recipient_page_view" }} /> : null}
    <p className="eyebrow">PASS ON THE JOY</p>
    <h1>{copy.title}</h1><p className="section-description">{copy.lead}</p>
    <div className="checkout-notice"><p>{copy.notice}</p><button className="secondary-button" disabled>{copy.disabledAction}</button></div>
    <Link className="primary-button" href="/flowers">{copy.action}<span aria-hidden="true">→</span></Link>
    <p className="field-note">{copy.privacy}</p>
  </section>;
}
