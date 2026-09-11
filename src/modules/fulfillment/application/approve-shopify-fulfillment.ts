/** Implement only with a verified, request-bound operator session. Never from request body or headers alone. */
export interface FulfillmentOperatorIdentity {
  current(): Promise<Readonly<{ operatorId: string; expiresAt: Date }> | null>;
}
export type FulfillmentApprovalRequest = Readonly<{
  shop: string; fulfillmentId: string; reviewedIntakeVersion: number; idempotencyKey: string;
}>;
/** A historical decision receipt, not a capability to schedule or dispatch. */
export type FulfillmentApprovalReceipt = Readonly<{
  outcome: "RECORDED" | "DUPLICATE"; approvalId: string; fulfillmentId: string;
  intakeVersion: number; approvedAt: Date; expiresAt: Date;
}>;
export interface ShopifyFulfillmentApprover {
  approve(input: FulfillmentApprovalRequest): Promise<FulfillmentApprovalReceipt>;
}
export class FulfillmentApprovalError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "NOT_AUTHORIZED" | "REVIEW_REQUIRED" | "CONFLICT" | "UNAVAILABLE") {
    super(`Fulfillment approval: ${code}`); this.name = "FulfillmentApprovalError";
  }
}
