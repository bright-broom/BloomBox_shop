import { headers } from "next/headers";
import { loyaltyProgress, type LoyaltyProgress } from "@/modules/customer/public";
import { PostgresCustomerPurchasePerformance } from "@/modules/order/infrastructure/postgres-customer-purchase-performance";
import { getApplicationDatabaseClient } from "./database/database-connections";
import { loadCustomerAccountConfig } from "./config/customer-account-config";
import { readCustomerCredential } from "./security/customer-auth/service";

export type CustomerLoyaltyState = { status: "ready"; progress: LoyaltyProgress } | { status: "unavailable" };
/** Composition-only; the caller must obtain this ID from the verified customer credential. */
export async function readVerifiedCustomerLoyalty(customerId: string): Promise<CustomerLoyaltyState> {
  try {
    const spend = await new PostgresCustomerPurchasePerformance(getApplicationDatabaseClient()).readEligibleSpend(customerId);
    return { status: "ready", progress: loyaltyProgress(spend) };
  } catch {
    console.error("customer_loyalty_unavailable");
    return { status: "unavailable" };
  }
}
export async function loadCurrentCustomerLoyalty(): Promise<CustomerLoyaltyState | null> {
  try {
    const config = loadCustomerAccountConfig();
    if (!config) return null;
    const credential = await readCustomerCredential((await headers()).get("cookie") ?? "", config);
    return credential ? readVerifiedCustomerLoyalty(credential.customerId) : null;
  } catch {
    console.error("customer_loyalty_auth_unavailable");
    return { status: "unavailable" };
  }
}
