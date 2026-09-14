import { createHash, timingSafeEqual } from "node:crypto";
import {
  getCommerceDataRetentionJob,
  getStripeInboxProcessor,
  getStripeEventReconciler,
  getStripeUnrecordedCheckoutRecovery,
} from "@/shared/infrastructure/composition-root";
import { loadCommerceWorkerSecret } from "@/shared/infrastructure/config/worker-config";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    const expected = `Bearer ${loadCommerceWorkerSecret()}`;
    const actual = request.headers.get("authorization") ?? "";
    if (!secureEqual(actual, expected)) {
      return Response.json({ ok: false }, { status: 401 });
    }

    const inboxBeforeReconciliation = await getStripeInboxProcessor().execute();
    const reconciliation = await getStripeEventReconciler().execute();
    const inboxAfterReconciliation = await getStripeInboxProcessor().execute();
    const retention = await getCommerceDataRetentionJob().execute();
    // After events are drained, settle expired Stripe checkouts whose session was never recorded by a provider lookup.
    const unrecordedCheckouts = await getStripeUnrecordedCheckoutRecovery().execute();
    const inbox = mergeInboxResults(inboxBeforeReconciliation, inboxAfterReconciliation);
    if (inbox.failed > 0) throw new ProviderInboxDeadLetterError();
    if (unrecordedCheckouts.heldForReview > 0) throw new UnrecordedCheckoutReviewRequiredError();
    return Response.json({ ok: true, inbox, reconciliation, retention, unrecordedCheckouts });
  } catch (error) {
    reportUnexpectedError(error, { operation: "reconcile_stripe_events" });
    return Response.json({ ok: false }, { status: 500 });
  }
}

class ProviderInboxDeadLetterError extends Error {
  constructor() {
    super("Provider inbox contains a terminally failed event");
    this.name = "ProviderInboxDeadLetterError";
  }
}

/** A Stripe session for an unrecorded checkout was found in a state that must not be released automatically. */
class UnrecordedCheckoutReviewRequiredError extends Error {
  constructor() {
    super("An unrecorded Stripe checkout requires operator review");
    this.name = "UnrecordedCheckoutReviewRequiredError";
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

function secureEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}
