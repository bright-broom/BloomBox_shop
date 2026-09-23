import { acceptsNewCheckout } from "@/shared/domain/commerce-activation";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { loadCheckoutIntakeEnabled } from "@/shared/infrastructure/config/checkout-provider-config";
import { productionCommerceApproval } from "@/shared/infrastructure/config/commerce-activation";

export const dynamic = "force-dynamic";

/** Whether this deployment accepts new purchases (ADR 0020). A configuration fault reads as paused. */
function commerceIntake(): "open" | "paused" {
  try {
    return acceptsNewCheckout({
      runtime: loadRuntimeMode(),
      intakeEnabled: loadCheckoutIntakeEnabled(),
      ...productionCommerceApproval(),
    }) ? "open" : "paused";
  } catch {
    return "paused";
  }
}

export async function GET() {
  return Response.json(
    {
      status: "ok",
      release: process.env.BLOOMBOX_RELEASE_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
      // The public smoke monitor checks the selling or non-selling contract according to this value.
      commerce: commerceIntake(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
