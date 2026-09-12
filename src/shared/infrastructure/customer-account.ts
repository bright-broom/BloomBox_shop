import { headers } from "next/headers";
import { CustomerLoginRequiredError, readCustomerAccount, type CustomerAccount } from "@/modules/customer/public";
import { ShopifyCustomerAccountReader } from "@/modules/customer/infrastructure/shopify-customer-account-reader";
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
    return { status: "ready", account: await readCustomerAccount(new ShopifyCustomerAccountReader(config, credential.accessToken), after) };
  } catch (error) {
    if (error instanceof CustomerLoginRequiredError) return { status: "expired" };
    console.error("customer_account_unavailable");
    return { status: "unavailable" };
  }
}
