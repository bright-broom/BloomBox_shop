import { redirect } from "next/navigation";
import { membershipWelcomeHref } from "@/shared/domain/auth-navigation";
import { loadMembershipAgreement } from "@/shared/infrastructure/customer-portal";

/**
 * Sends a signed-in member who has not agreed to the current terms to the agreement step.
 * Signed-out and unavailable states are left to the page, which already handles them.
 */
export async function requireMembershipAgreement(destination: string): Promise<void> {
  const state = await loadMembershipAgreement();
  if (state.status === "ready" && state.agreement.status === "required") redirect(membershipWelcomeHref(destination));
}
