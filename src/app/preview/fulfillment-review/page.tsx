import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { FulfillmentReview } from "@/modules/fulfillment/public";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { fulfillmentReviewContent as copy } from "@/shared/infrastructure/content/fulfillment-review-content";
import { FulfillmentReviewPanel } from "@/ui/fulfillment-review";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
const scenarios = ["pending", "expired", "refund", "recorded"] as const;

export default async function FulfillmentReviewPreview({ searchParams }: { searchParams: Promise<{ state?: string | string[] }> }) {
  if (loadRuntimeMode() !== "preview") notFound();
  const { state } = await searchParams;
  const scenario = scenarios.find((item) => item === state) ?? "pending";
  // Static synthetic evidence only. No database connection, identity impersonation or approval command.
  const review: FulfillmentReview = {
    fulfillmentId: "00000000-0000-4000-8000-000000000001", orderId: "00000000-0000-4000-8000-000000000002", intakeVersion: 3,
    observedAt: "2026-09-12T01:00:00Z", viewedAt: "2026-09-12T01:00:10Z", deliveryDate: "2026-09-16", status: "UNFULFILLED", orderStatus: "CONFIRMED",
    reason: scenario === "refund" ? "PARTIAL_REFUND" : "DISPATCH_APPROVAL_REQUIRED",
    totalMinor: 5000, capturedMinor: 5000, refundedMinor: scenario === "refund" ? 500 : 0, paymentEvidenceCurrent: scenario !== "refund",
    items: [{ name: "BLOOM BOX M", quantity: 1 }],
    stock: { status: scenario === "expired" ? "UNVERIFIED" : "COVERED", reason: scenario === "expired" ? "STALE_SNAPSHOT" : "COMMITMENTS_COVERED",
      checkedAt: scenario === "expired" ? "2026-09-12T00:59:00Z" : "2026-09-12T01:00:00Z",
      expiresAt: scenario === "expired" ? "2026-09-12T00:59:30Z" : "2026-09-12T01:00:30Z" },
    quantities: { status: "NONE", reason: "MATCHED", ordered: 1, shipped: 0, delivered: 0 },
    latestApproval: scenario === "recorded" ? { recordedAt: "2026-09-12T01:00:05Z", expiresAt: "2026-09-12T01:00:30Z", intakeVersion: 3 } : null,
  };
  return <section className="section-shell fulfillment-review-page">
    <header className="fulfillment-review-heading"><p className="eyebrow">OPERATIONS PREVIEW</p><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    <div className="fulfillment-preview-notice"><strong>{copy.previewTitle}</strong><p>{copy.previewNotice}</p></div>
    <nav className="fulfillment-scenarios" aria-label={copy.scenariosLabel}>{scenarios.map((item) =>
      <Link key={item} className="secondary-button" href={`/preview/fulfillment-review?state=${item}`} aria-current={scenario === item ? "page" : undefined}>{copy.scenarios[item]}</Link>)}</nav>
    <FulfillmentReviewPanel review={review} />
    <section className="fulfillment-connection"><h2>{copy.connectionTitle}</h2><p>{copy.connectionNote}</p>
      <Link className="text-link" href="/preview/gift-experience">{copy.back}</Link></section>
  </section>;
}
