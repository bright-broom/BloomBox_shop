"use server";
import { revalidatePath } from "next/cache";
import { answerCustomerRequest } from "@/shared/infrastructure/security/operator-auth/customer-requests";
import { AccountPortalError } from "@/modules/customer/public";
import type { PortalActionState } from "@/app/account/portal-actions";
export async function replyToCustomer(
  _previous: PortalActionState,
  form: FormData,
): Promise<PortalActionState> {
  try {
    await answerCustomerRequest(form);
    revalidatePath("/operations/requests");
    return { status: "saved" };
  } catch (error) {
    console.error("customer_request_reply_failed");
    return {
      status: "error",
      error: error instanceof AccountPortalError ? error.code : "unavailable",
    };
  }
}
