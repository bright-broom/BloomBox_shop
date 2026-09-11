import type { FulfillmentReview } from "../application/read-fulfillment-review";

/** Display priority only. The approval command independently authenticates and revalidates all facts. */
export function fulfillmentReviewSummary(review: FulfillmentReview): "REVIEW_REQUIRED" | "RECORDED" | "PENDING" {
  if (review.status !== "UNFULFILLED" || review.orderStatus !== "CONFIRMED"
    || (review.latestApproval && review.latestApproval.intakeVersion !== review.intakeVersion)
    || review.reason !== "DISPATCH_APPROVAL_REQUIRED" || !review.paymentEvidenceCurrent || review.refundedMinor > 0
    || review.stock.status !== "COVERED" || review.quantities.status !== "NONE" || review.quantities.reason !== "MATCHED") return "REVIEW_REQUIRED";
  return review.latestApproval ? "RECORDED" : "PENDING";
}
