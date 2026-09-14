import { readVerifiedCustomerLoyalty, type CustomerLoyaltyState } from "./customer-loyalty";
import { headers } from "next/headers";
import type { CustomerOrderDetail } from "@/modules/order/public";
import { CustomerLoginRequiredError, NativeCustomerAccountReader, readCustomerAccount, type CustomerAccount } from "@/modules/customer/public";
import { PostgresCustomerOrderHistory } from "@/modules/order/infrastructure/postgres-customer-order-history";
import { getApplicationDatabaseClient } from "./database/database-connections";
import { loadCustomerAccountConfig } from "./config/customer-account-config";
import { readCustomerCredential } from "./security/customer-auth/service";

export type CustomerAccountState = { status: "disabled" | "signed-out" | "expired" | "unavailable" }
  | { status: "ready"; account: CustomerAccount; loyalty?: CustomerLoyaltyState };
export type CustomerOrderDetailState = { status: "disabled" | "signed-out" | "unavailable" | "not-found" }
  | { status: "ready"; order: CustomerOrderDetail };
export async function loadCustomerOrderDetail(orderId: string): Promise<CustomerOrderDetailState> {
  try {
    const config = loadCustomerAccountConfig();
    if (!config) return { status: "disabled" };
    const credential = await readCustomerCredential((await headers()).get("cookie") ?? "", config);
    if (!credential) return { status: "signed-out" };
    const order = await new PostgresCustomerOrderHistory(getApplicationDatabaseClient()).readDetail(credential.customerId, orderId);
    return order ? { status: "ready", order } : { status: "not-found" };
  } catch {
    console.error("customer_order_detail_unavailable");
    return { status: "unavailable" };
  }
}
export async function loadCustomerAccount(after: unknown): Promise<CustomerAccountState> {
  try {
    const config = loadCustomerAccountConfig();
    if (!config) return { status: "disabled" };
    const cookie = (await headers()).get("cookie") ?? "";
    const credential = await readCustomerCredential(cookie, config);
    if (!credential) return { status: "signed-out" };
    const [account, loyalty] = await Promise.all([
      readCustomerAccount(new NativeCustomerAccountReader(credential, new PostgresCustomerOrderHistory(getApplicationDatabaseClient())), after),
      readVerifiedCustomerLoyalty(credential.customerId),
    ]);
    return { status: "ready", account, loyalty };
  } catch (error) {
    if (error instanceof CustomerLoginRequiredError) return { status: "expired" };
    console.error("customer_account_unavailable");
    return { status: "unavailable" };
  }
}
