import { headers } from "next/headers";
import { loadRuntimeMode } from "../../config/runtime-config";
import { loadCustomerAccountConfig } from "../../config/customer-account-config";
import { readCustomerCredential } from "./service";
import type { CurrentPurchaseCustomer } from "@/modules/checkout/application/current-purchase-customer";

export const readCurrentPurchaseCustomer: CurrentPurchaseCustomer = async () => {
  // Preview receipts must never attach to a durable customer account.
  if (loadRuntimeMode() === "preview") return null;
  const config = loadCustomerAccountConfig();
  if (!config) return null;
  const cookie = (await headers()).get("cookie") ?? "";
  const identity = await readCustomerCredential(cookie, config);
  // Provider/DB errors propagate; an outage must not silently become guest checkout.
  return identity ? { customerId: identity.customerId, version: identity.version } : null;
};
