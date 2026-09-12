import { headers } from "next/headers";
import { CustomerLoginRequiredError, NativeCustomerAccountReader, readCustomerAccount, type CustomerAccount } from "@/modules/customer/public";
import { PostgresCustomerOrderHistory } from "@/modules/order/infrastructure/postgres-customer-order-history";
import { getApplicationDatabaseClient } from "./database/database-connections";
import { loadCustomerAccountConfig } from "./config/customer-account-config";
import { readCustomerCredential } from "./security/customer-auth/service";

export type CustomerAccountState = { status: "disabled" | "signed-out" | "expired" | "unavailable" }
  | { status: "ready"; account: CustomerAccount };
export async function loadCustomerAccount(after: unknown): Promise<CustomerAccountState> {
  try {
    const config = loadCustomerAccountConfig();
    if (!config) return { status: "disabled" };
    const cookie = (await headers()).get("cookie") ?? "";
    const credential = await readCustomerCredential(cookie, config);
    if (!credential) return { status: "signed-out" };
    return { status: "ready", account: await readCustomerAccount(new NativeCustomerAccountReader(credential, new PostgresCustomerOrderHistory(getApplicationDatabaseClient())), after) };
  } catch (error) {
    if (error instanceof CustomerLoginRequiredError) return { status: "expired" };
    console.error("customer_account_unavailable");
    return { status: "unavailable" };
  }
}
