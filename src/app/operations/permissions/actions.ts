"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { PermissionRevocationError, FulfillmentApprovalError, type PermissionManagementState } from "@/modules/fulfillment/public";
import { revokeOperatorPermission } from "@/shared/infrastructure/security/operator-auth/operator-permissions";

export async function revokePermission(_previous: PermissionManagementState, form: FormData): Promise<PermissionManagementState> {
  let result;
  try { result = await revokeOperatorPermission(form, (await headers()).get("origin")); }
  catch (error) {
    if (error instanceof PermissionRevocationError || error instanceof FulfillmentApprovalError) {
      if (error.code === "UNAVAILABLE") console.error("operator_permission_revocation_unavailable");
      return { status: error.code };
    }
    console.error("operator_permission_revocation_unavailable");
    return { status: "UNAVAILABLE" };
  }
  try { revalidatePath("/operations/permissions"); }
  catch { console.error("operator_permissions_refresh_unavailable"); }
  return { status: result.outcome };
}
