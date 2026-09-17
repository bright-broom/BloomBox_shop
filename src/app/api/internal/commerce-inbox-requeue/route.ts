import { readBoundedRequestBody } from "@/shared/infrastructure/http/bounded-request-body";
import {
  InvalidFailedInboxRequeueRequestError,
  parseFailedInboxRequeueRequest,
} from "@/modules/payment/public";
import { getStripeFailedInboxRequeue } from "@/shared/infrastructure/composition-root";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
import { isAuthorizedCommerceWorkerRequest } from "@/shared/infrastructure/security/worker-authorization";

export const runtime = "nodejs";
export const maxDuration = 60;
// Enough for the existing workflow's 20 maximum-length event IDs and audit fields.
const MAX_REQUEST_BYTES = 16_384;
const READ_TIMEOUT_MS = 5_000;
const headers = { "Cache-Control": "no-store" };

/**
 * Requeues explicitly named FAILED Stripe Inbox events after an operator resolved their cause.
 * Invoked only by the protected "Commerce Inbox Requeue" workflow; see docs/operations/COMMERCE_WORKER_INCIDENTS.md.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isAuthorizedCommerceWorkerRequest(request)) {
      return Response.json({ ok: false }, { status: 401, headers });
    }
    let body: unknown;
    try {
      const bytes = await readBoundedRequestBody(request, { maxBytes: MAX_REQUEST_BYTES, timeoutMs: READ_TIMEOUT_MS });
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers });
    }
    const requeueRequest = parseFailedInboxRequeueRequest(body);
    const result = await getStripeFailedInboxRequeue().execute(requeueRequest);
    return Response.json({ ok: true, ...result }, { headers });
  } catch (error) {
    if (error instanceof InvalidFailedInboxRequeueRequestError) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers });
    }
    reportUnexpectedError(error, { operation: "requeue_failed_inbox_events" });
    return Response.json({ ok: false }, { status: 500, headers });
  }
}
