"use server";
import { redirect } from "next/navigation";
import { getCustomerAuth } from "@/shared/infrastructure/security/customer-auth/service";
import { revalidatePath } from "next/cache";
import { AccountPortalError } from "@/modules/customer/public";
import {
  changeCustomerPortal,
  createCustomerRequest,
  customerPortalContext,
} from "@/shared/infrastructure/customer-portal";
import { endCustomerLogin } from "./actions";
export type PortalActionState = {
  status: "idle" | "saved" | "sent" | "error";
  error?: string;
};
export async function saveAccountPreferences(
  _previous: PortalActionState,
  form: FormData,
): Promise<PortalActionState> {
  try {
    await changeCustomerPortal(form);
    revalidatePath("/account", "layout");
    return { status: "saved" };
  } catch (error) {
    if (!(error instanceof AccountPortalError))
      console.error("customer_portal_write_failed");
    return {
      status: "error",
      error: error instanceof AccountPortalError ? error.code : "unavailable",
    };
  }
}
export async function sendAccountRequest(
  _previous: PortalActionState,
  form: FormData,
): Promise<PortalActionState> {
  try {
    await createCustomerRequest(form);
    revalidatePath("/account/support");
    return { status: "sent" };
  } catch (error) {
    if (!(error instanceof AccountPortalError))
      console.error("customer_request_write_failed");
    return {
      status: "error",
      error: error instanceof AccountPortalError ? error.code : "unavailable",
    };
  }
}
export async function endAllCustomerSessions(
  _previous: PortalActionState,
  form: FormData,
): Promise<PortalActionState> {
  try {
    const { actor, repository } = await customerPortalContext(true);
    if (form.get("close") === "yes") {
      if (form.get("confirm") !== "on") throw new AccountPortalError("invalid");
      await repository.close(actor);
    } else {
      await repository.revokeSessions(actor);
    }
  } catch (error) {
    if (!(error instanceof AccountPortalError))
      console.error("customer_session_update_failed");
    return {
      status: "error",
      error: error instanceof AccountPortalError ? error.code : "unavailable",
    };
  }
  if (form.get("close") === "yes") {
    await getCustomerAuth()?.auth.signOut({ redirect: false });
    redirect("/account/closed");
  }
  await endCustomerLogin();
  return { status: "saved" };
}
