import { FulfillmentApprovalError, FulfillmentReviewError, FULFILLMENT_INTAKE_POLICY, fulfillmentReviewSummary,
  type ApprovalFormControl, type FulfillmentApprovalReceipt } from "@/modules/fulfillment/public";
import { PostgresFulfillmentReviewQuery } from "@/modules/fulfillment/infrastructure/postgres-fulfillment-review-query";
import { PostgresShopifyFulfillmentApprover } from "@/modules/fulfillment/infrastructure/postgres-shopify-fulfillment-approver";
import { getOperatorDatabaseClient } from "../../database/database-connections";
import { getOperatorAuth } from "./operator-auth";
import { GoogleFulfillmentOperatorIdentity } from "./google-operator-identity";
import { OperatorApprovalIntent } from "./approval-intent";

export async function prepareOperatorApproval(input: Readonly<{ shop: string; fulfillmentId: string }>) {
  const service = getOperatorAuth();
  if (!service) throw new FulfillmentReviewError("NOT_AUTHORIZED");
  const session = await service.auth.auth();
  const identity = new GoogleFulfillmentOperatorIdentity(async () => session, service.config.bindings);
  const actor = await identity.current();
  if (!actor) throw new FulfillmentReviewError("NOT_AUTHORIZED");
  const review = await new PostgresFulfillmentReviewQuery(getOperatorDatabaseClient(), service.config.testMode, identity).find(input);
  if (!review) return null;
  let control: ApprovalFormControl;
  const summary = fulfillmentReviewSummary(review);
  if (FULFILLMENT_INTAKE_POLICY.approval !== "APPROVED") control = { status: "POLICY_PENDING", intent: null };
  else if (summary !== "PENDING") control = { status: summary, intent: null };
  else {
    const intent = await new OperatorApprovalIntent(service.config.secret, service.config.origin).issue({ shop: input.shop,
      fulfillmentId: review.fulfillmentId, reviewedIntakeVersion: review.intakeVersion }, actor, service.config.testMode);
    control = { status: "READY", intent };
  }
  return { review, control };
}

export async function recordOperatorApproval(form: FormData, origin: string | null): Promise<Readonly<{
  receipt: FulfillmentApprovalReceipt; reviewPath: string;
}>> {
  const service = getOperatorAuth();
  if (!service || origin !== service.config.origin) throw new FulfillmentApprovalError("NOT_AUTHORIZED");
  const session = await service.auth.auth();
  const identity = new GoogleFulfillmentOperatorIdentity(async () => session, service.config.bindings);
  const actor = await identity.current();
  if (!actor) throw new FulfillmentApprovalError("NOT_AUTHORIZED");
  const token = form.get("intent");
  if (typeof token !== "string" || token.length > 2048 || form.getAll("intent").length !== 1
    || form.getAll("acknowledged").length !== 1 || form.get("acknowledged") !== "yes"
    || [...form.keys()].some((name) => name !== "intent" && name !== "acknowledged" && !name.startsWith("$ACTION_"))) {
    throw new FulfillmentApprovalError("INVALID_REQUEST");
  }
  // A prepared form cannot lift the merchant-policy gate. No database write path while pending.
  if (FULFILLMENT_INTAKE_POLICY.approval !== "APPROVED") throw new FulfillmentApprovalError("REVIEW_REQUIRED");
  const request = await new OperatorApprovalIntent(service.config.secret, service.config.origin).read(token, actor, service.config.testMode);
  const receipt = await new PostgresShopifyFulfillmentApprover(getOperatorDatabaseClient(), service.config.testMode, identity).approve(request);
  return { receipt, reviewPath: `/operations/fulfillments/${request.shop}/${request.fulfillmentId}` };
}
