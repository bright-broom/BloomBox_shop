import { FulfillmentReviewError, type FulfillmentInboxRequest } from "@/modules/fulfillment/public";
import { PostgresFulfillmentInboxQuery } from "@/modules/fulfillment/infrastructure/postgres-fulfillment-inbox-query";
import { getOperatorDatabaseClient } from "../../database/database-connections";
import { getOperatorAuth } from "./operator-auth";
import { GoogleFulfillmentOperatorIdentity } from "./google-operator-identity";

export async function readOperatorInbox(input: FulfillmentInboxRequest) {
  const service = getOperatorAuth();
  if (!service) throw new FulfillmentReviewError("NOT_AUTHORIZED");
  const session = await service.auth.auth();
  const identity = new GoogleFulfillmentOperatorIdentity(async () => session, service.config.bindings);
  if (!(await identity.current())) throw new FulfillmentReviewError("NOT_AUTHORIZED");
  return new PostgresFulfillmentInboxQuery(getOperatorDatabaseClient(), service.config.testMode, identity).list(input);
}
