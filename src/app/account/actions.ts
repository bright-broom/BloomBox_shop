"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ACCOUNT_HOME, loginDestination, loginHref } from "@/shared/domain/auth-navigation";
import { AuthError } from "next-auth";
import { AccountPortalError } from "@/modules/customer/public";
import { getCustomerAuth } from "@/shared/infrastructure/security/customer-auth/service";
import { recordMembershipAgreement } from "@/shared/infrastructure/customer-portal";

async function serviceForMutation() {
  const service = getCustomerAuth();
  if (!service || (await headers()).get("origin") !== service.config.origin) redirect("/account/login?error=unavailable");
  return service;
}
export async function startCustomerLogin(formData?: FormData) {
  const service = await serviceForMutation();
  try { await service.auth.signIn("google", { redirectTo: loginDestination(formData?.get("next"), "customer") }); }
  catch (error) { if (error instanceof AuthError) redirect("/account/login?error=signin"); throw error; }
}
/** Registration is the same verified Google sign-in, followed by the agreement step. */
export async function startCustomerRegistration() {
  const service = await serviceForMutation();
  try { await service.auth.signIn("google", { redirectTo: `${ACCOUNT_HOME}/welcome` }); }
  catch (error) { if (error instanceof AuthError) redirect("/account/register?error=signin"); throw error; }
}
export async function agreeToMembership(formData: FormData) {
  const next = loginDestination(formData.get("next"), "customer");
  const destination = next === `${ACCOUNT_HOME}/welcome` ? ACCOUNT_HOME : next;
  let failure: string | null = null;
  try {
    await recordMembershipAgreement(formData);
  } catch (error) {
    if (!(error instanceof AccountPortalError)) console.error("customer_membership_agreement_write_failed");
    failure = error instanceof AccountPortalError ? error.code : "unavailable";
  }
  if (failure === "expired") redirect(loginHref("customer", `${ACCOUNT_HOME}/welcome`));
  if (failure) {
    const query = new URLSearchParams({ error: failure === "invalid" || failure === "conflict" ? failure : "unavailable" });
    if (destination !== ACCOUNT_HOME) query.set("next", destination);
    redirect(`${ACCOUNT_HOME}/welcome?${query}`);
  }
  revalidatePath(ACCOUNT_HOME, "layout");
  redirect(destination === ACCOUNT_HOME ? `${ACCOUNT_HOME}?welcome=1` : destination);
}
export async function endCustomerLogin() {
  const service = await serviceForMutation();
  await service.auth.signOut({ redirectTo: "/account/login" });
}
