import Link from "next/link";
import { fulfillmentInboxContent } from "@/shared/infrastructure/content/fulfillment-inbox-content";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FulfillmentReviewError } from "@/modules/fulfillment/public";
import { prepareOperatorApproval } from "@/shared/infrastructure/security/operator-auth/operator-approval";
import { FulfillmentApprovalForm } from "@/ui/fulfillment-approval-form";
import { recordFulfillmentApproval } from "../../actions";
import { fulfillmentReviewContent as copy } from "@/shared/infrastructure/content/fulfillment-review-content";
import { FulfillmentReviewPanel } from "@/ui/fulfillment-review";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
export default async function OperatorFulfillmentReview({ params }: { params: Promise<{ shop: string; fulfillmentId: string }> }) {
  const input = await params;
  const page = await loadReview(input);
  if (!page) notFound();
  const { review, control } = page;
  return <section className="section-shell fulfillment-review-page">
    <header className="fulfillment-review-heading"><p className="eyebrow">BLOOMBOX OPERATIONS</p><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    <Link className="text-link" prefetch={false} href={`/operations/fulfillments?${new URLSearchParams({ shop: input.shop })}`}>{fulfillmentInboxContent.title}</Link>
    <FulfillmentReviewPanel review={review} />
    <FulfillmentApprovalForm control={control} reviewPath={`/operations/fulfillments/${encodeURIComponent(input.shop)}/${review.fulfillmentId}`} action={recordFulfillmentApproval} />
  </section>;
}
async function loadReview(input: { shop: string; fulfillmentId: string }) {
  try { return await prepareOperatorApproval(input); }
  catch (error) {
    if (error instanceof FulfillmentReviewError && error.code !== "UNAVAILABLE") return null;
    console.error("operator_review_unavailable");
    // No configuration, query input or provider details reach the public error boundary.
    throw new Error("Operator review unavailable");
  }
}
