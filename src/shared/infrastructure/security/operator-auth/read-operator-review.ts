import { FulfillmentReviewError } from "@/modules/fulfillment/public";
import { PostgresFulfillmentReviewQuery } from "@/modules/fulfillment/infrastructure/postgres-fulfillment-review-query";
import { getOperatorDatabaseClient } from "../../database/database-connections";
import { getOperatorAuth } from "./operator-auth";
import { GoogleFulfillmentOperatorIdentity } from "./google-operator-identity";

export async function readOperatorReview(input: Readonly<{ shop: string; fulfillmentId: string }>) {
  const service = getOperatorAuth();
  if (!service) throw new FulfillmentReviewError("NOT_AUTHORIZED");
  const session = await service.auth.auth();
  const identity = new GoogleFulfillmentOperatorIdentity(async () => session, service.config.bindings);
  // No database connection is initialized for an unauthenticated or unregistered account.
  if (!(await identity.current())) throw new FulfillmentReviewError("NOT_AUTHORIZED");
  return new PostgresFulfillmentReviewQuery(getOperatorDatabaseClient(), service.config.testMode, identity).find(input);
}
