"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { getCustomerAuth } from "@/shared/infrastructure/security/customer-auth/service";

async function serviceForMutation() {
  const service = getCustomerAuth();
  if (!service || (await headers()).get("origin") !== service.config.origin) redirect("/account?error=unavailable");
  return service;
}
export async function startCustomerLogin() {
  const service = await serviceForMutation();
  try { await service.auth.signIn("shopify-customer", { redirectTo: "/account" }); }
  catch (error) { if (error instanceof AuthError) redirect("/account?error=signin"); throw error; }
}
export async function endCustomerLogin() {
  const service = await serviceForMutation();
  await service.auth.signOut({ redirectTo: "/account" });
}
