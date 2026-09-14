"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loginDestination } from "@/shared/domain/auth-navigation";
import { AuthError } from "next-auth";
import { getOperatorAuth } from "@/shared/infrastructure/security/operator-auth/operator-auth";

async function serviceForMutation() {
  const service = getOperatorAuth();
  if (!service || (await headers()).get("origin") !== service.config.origin) redirect("/operations/login?error=unavailable");
  return service;
}
export async function startOperatorLogin(formData?: FormData) {
  const service = await serviceForMutation();
  try { await service.auth.signIn("google", { redirectTo: loginDestination(formData?.get("next"), "operator") }); }
  catch (error) { if (error instanceof AuthError) redirect("/operations/login?error=signin"); throw error; }
}
export async function endOperatorLogin() {
  const service = await serviceForMutation();
  await service.auth.signOut({ redirectTo: "/operations/login" });
}
