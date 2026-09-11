"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { getOperatorAuth } from "@/shared/infrastructure/security/operator-auth/operator-auth";

async function serviceForMutation() {
  const service = getOperatorAuth();
  if (!service || (await headers()).get("origin") !== service.config.origin) redirect("/operations?error=unavailable");
  return service;
}
export async function startOperatorLogin() {
  const service = await serviceForMutation();
  try { await service.auth.signIn("google", { redirectTo: "/operations" }); }
  catch (error) { if (error instanceof AuthError) redirect("/operations?error=signin"); throw error; }
}
export async function endOperatorLogin() {
  const service = await serviceForMutation();
  await service.auth.signOut({ redirectTo: "/operations" });
}
