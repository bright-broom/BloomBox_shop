"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { FulfillmentApprovalError, type ApprovalFormState } from "@/modules/fulfillment/public";
import { recordOperatorApproval } from "@/shared/infrastructure/security/operator-auth/operator-approval";

export async function recordFulfillmentApproval(_previous: ApprovalFormState, form: FormData): Promise<ApprovalFormState> {
  let result;
  try { result = await recordOperatorApproval(form, (await headers()).get("origin")); }
  catch (error) {
    if (error instanceof FulfillmentApprovalError) {
      if (error.code === "UNAVAILABLE") console.error("operator_approval_unavailable");
      return { status: error.code };
    }
    console.error("operator_approval_unavailable");
    return { status: "UNAVAILABLE" };
  }
  // Refresh only the authenticated target; never trust a browser-supplied redirect or status.
  try { revalidatePath(result.reviewPath); }
  catch { console.error("operator_approval_refresh_unavailable"); }
  return { status: result.receipt.outcome };
}
