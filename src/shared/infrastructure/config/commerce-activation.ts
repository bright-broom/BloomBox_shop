import { isCommerceActivationApproved } from "@/shared/domain/commerce-activation";
import activation from "../../../../config/production-commerce-activation.json";
import { storefrontContent } from "../content/storefront-content";

/**
 * The reviewed activation record and terms bundled with this build. Changing either requires a reviewed PR
 * and a new deployment, so production intake cannot be opened by an environment variable alone.
 */
export function productionCommerceApproval(): Readonly<{ activationApproved: boolean; storefrontApproved: boolean }> {
  return {
    activationApproved: isCommerceActivationApproved(activation),
    storefrontApproved: storefrontContent.publicationStatus === "approved",
  };
}
