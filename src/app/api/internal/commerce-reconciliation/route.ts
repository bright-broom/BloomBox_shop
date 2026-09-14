import {
  getCommerceDataRetentionJob,
  getCommerceWorkerAttention,
  getStripeInboxProcessor,
  getStripeEventReconciler,
  getStripeUnrecordedCheckoutRecovery,
} from "@/shared/infrastructure/composition-root";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
import { isAuthorizedCommerceWorkerRequest } from "@/shared/infrastructure/security/worker-authorization";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isAuthorizedCommerceWorkerRequest(request)) {
      return Response.json({ ok: false }, { status: 401 });
    }

    const inboxBeforeReconciliation = await getStripeInboxProcessor().execute();
    const reconciliation = await getStripeEventReconciler().execute();
    const inboxAfterReconciliation = await getStripeInboxProcessor().execute();
    const retention = await getCommerceDataRetentionJob().execute();
    // After events are drained, settle expired Stripe checkouts whose session was never recorded by a provider lookup.
    const unrecordedCheckouts = await getStripeUnrecordedCheckoutRecovery().execute();
    const inbox = mergeInboxResults(inboxBeforeReconciliation, inboxAfterReconciliation);
    // Count unresolved dead letters and checkouts awaiting review on every run, so the incident stays open until
    // they are resolved rather than closing after the next quiet run. Only counts are returned.
    const attention = await getCommerceWorkerAttention().execute();
    if (attention.requiresAttention) {
      return Response.json({ ok: false, attention }, { status: 500 });
    }
    return Response.json({ ok: true, inbox, reconciliation, retention, unrecordedCheckouts, attention });
  } catch (error) {
    reportUnexpectedError(error, { operation: "reconcile_stripe_events" });
    return Response.json({ ok: false }, { status: 500 });
  }
}

function mergeInboxResults(
  left: Readonly<{ claimed: number; processed: number; retryScheduled: number; failed: number }>,
  right: Readonly<{ claimed: number; processed: number; retryScheduled: number; failed: number }>,
) {
  return {
    claimed: left.claimed + right.claimed,
    processed: left.processed + right.processed,
    retryScheduled: left.retryScheduled + right.retryScheduled,
    failed: left.failed + right.failed,
  };
}
