import type { FulfillmentStatus } from "../domain/fulfillment-status";
import type { FulfillmentStockAssessment } from "../domain/shopify-fulfillment-stock";
import type { FulfillmentQuantityAssessment } from "../domain/shopify-fulfillment-quantities";

/** Minimal operator view. No recipient/buyer identity, address, gift text or authorization capability. */
export type FulfillmentReview = Readonly<{
  fulfillmentId: string; orderId: string; intakeVersion: number; observedAt: string; viewedAt: string;
  status: FulfillmentStatus; orderStatus: "PENDING_CONFIRMATION" | "CONFIRMED" | "CANCELLED" | "CLOSED"; reason: string; deliveryDate: string;
  totalMinor: number; capturedMinor: number; refundedMinor: number; paymentEvidenceCurrent: boolean;
  items: ReadonlyArray<Readonly<{ name: string; quantity: number }>>;
  stock: FulfillmentStockAssessment & Readonly<{ checkedAt: string | null; expiresAt: string | null }>;
  quantities: FulfillmentQuantityAssessment;
  latestApproval: Readonly<{ recordedAt: string; expiresAt: string; intakeVersion: number }> | null;
}>;
export interface FulfillmentReviewQuery {
  find(input: Readonly<{ shop: string; fulfillmentId: string }>): Promise<FulfillmentReview | null>;
}
export class FulfillmentReviewError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "NOT_AUTHORIZED" | "UNAVAILABLE") {
    super(`Fulfillment review: ${code}`); this.name = "FulfillmentReviewError";
  }
}
