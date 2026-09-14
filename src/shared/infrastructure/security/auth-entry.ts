import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loginHref } from "@/shared/domain/auth-navigation";
import { loadCustomerAccountConfig } from "../config/customer-account-config";
import { readCustomerCredential } from "./customer-auth/service";
import { getOperatorAuth } from "./operator-auth/operator-auth";
import { GoogleFulfillmentOperatorIdentity } from "./operator-auth/google-operator-identity";

export type CustomerEntry = { status: "disabled" | "signed-out" | "unavailable" | "ready" };
export async function loadCustomerEntry(): Promise<CustomerEntry> {
  try {
    const config = loadCustomerAccountConfig();
    if (!config) return { status: "disabled" };
    const credential = await readCustomerCredential((await headers()).get("cookie") ?? "", config);
    return { status: credential ? "ready" : "signed-out" };
  } catch { console.error("customer_login_unavailable"); return { status: "unavailable" }; }
}
export type OperatorEntry = { status: "disabled" | "signed-out" | "unavailable" }
  | { status: "ready"; subject: string; bound: boolean };
export async function loadOperatorEntry(): Promise<OperatorEntry> {
  try {
    const service = getOperatorAuth();
    if (!service) return { status: "disabled" };
    const session = await service.auth.auth();
    const subject = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/).safeParse(session?.user?.id);
    if (!subject.success) return { status: "signed-out" };
    const identity = await new GoogleFulfillmentOperatorIdentity(async () => session, service.config.bindings).current();
    return { status: "ready", subject: subject.data, bound: identity !== null };
  } catch { console.error("operator_login_unavailable"); return { status: "unavailable" }; }
}
/** Page-entry UX only. Existing data-layer role/ownership checks remain mandatory. */
export async function requireOperatorLogin(destination: string): Promise<void> {
  const state = await loadOperatorEntry();
  if (state.status !== "ready" || !state.bound) redirect(loginHref("operator", destination));
}
