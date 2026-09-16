import { headers } from "next/headers";
import {
  CustomerManagementError,
  AccountPortalError,
} from "@/modules/customer/public";
import {
  PostgresCustomerRequests,
  requestReplySchema,
} from "@/modules/customer/infrastructure/postgres-customer-requests";
import { getCustomerSupportDatabaseClient } from "../../database/database-connections";
import { loadDataProtectionConfig } from "../../config/data-protection-config";
import { AesGcmDataProtector } from "../aes-gcm-data-protector";
import { getOperatorAuth } from "./operator-auth";
import { GoogleFulfillmentOperatorIdentity } from "./google-operator-identity";
import { withCustomerSupport } from "./customer-management-transaction";
async function context(mutation = false) {
  const auth = getOperatorAuth();
  if (
    !auth ||
    (mutation && (await headers()).get("origin") !== auth.config.origin)
  )
    throw new CustomerManagementError("DENIED");
  const actor = await new GoogleFulfillmentOperatorIdentity(
    () => auth.auth.auth(),
    auth.config.bindings,
  ).current();
  if (!actor) throw new CustomerManagementError("DENIED");
  return {
    actor,
    sql: getCustomerSupportDatabaseClient(),
    protector: new AesGcmDataProtector(loadDataProtectionConfig()),
  };
}
export async function openCustomerRequests(closed: boolean) {
  const { actor, sql, protector } = await context();
  return withCustomerSupport(sql, actor, "HISTORY", async (tx) => {
    const repository = new PostgresCustomerRequests(tx, protector);
    const requests = await repository.list(closed),
      privacy = await repository.privacyQueue();
    return {
      value: { requests, privacy },
      customerIds: [
        ...new Set([
          ...requests.map((r) => r.customerId),
          ...privacy.flatMap((r) => (r.customer_id ? [r.customer_id] : [])),
        ]),
      ],
    };
  });
}
export async function answerCustomerRequest(form: FormData) {
  const { actor, sql, protector } = await context(true);
  const parsed = requestReplySchema.safeParse({
    id: form.get("id"),
    revision: form.get("revision"),
    status: form.get("status"),
    reply: form.get("reply"),
  });
  if (!parsed.success) throw new AccountPortalError("invalid");
  return withCustomerSupport(sql, actor, "HISTORY", async (tx) => {
    const customerId = await new PostgresCustomerRequests(tx, protector).reply(
      parsed.data,
      actor.operatorId,
    );
    return { value: undefined, customerIds: [customerId] };
  });
}
