"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loginDestination } from "@/shared/domain/auth-navigation";
import { AuthError } from "next-auth";
import { getCustomerAuth } from "@/shared/infrastructure/security/customer-auth/service";

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
export async function endCustomerLogin() {
  const service = await serviceForMutation();
  await service.auth.signOut({ redirectTo: "/account/login" });
}
