import {
  InvalidFailedInboxRequeueRequestError,
  parseFailedInboxRequeueRequest,
} from "@/modules/payment/public";
import { getStripeFailedInboxRequeue } from "@/shared/infrastructure/composition-root";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
import { isAuthorizedCommerceWorkerRequest } from "@/shared/infrastructure/security/worker-authorization";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Requeues explicitly named FAILED Stripe Inbox events after an operator resolved their cause.
 * Invoked only by the protected "Commerce Inbox Requeue" workflow; see docs/operations/COMMERCE_WORKER_INCIDENTS.md.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isAuthorizedCommerceWorkerRequest(request)) {
      return Response.json({ ok: false }, { status: 401 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }
    const requeueRequest = parseFailedInboxRequeueRequest(body);
    const result = await getStripeFailedInboxRequeue().execute(requeueRequest);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof InvalidFailedInboxRequeueRequestError) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }
    reportUnexpectedError(error, { operation: "requeue_failed_inbox_events" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
