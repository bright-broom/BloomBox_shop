import { readBoundedRequestBody } from "@/shared/infrastructure/http/bounded-request-body";
import { InvalidFailedInboxRequeueRequestError, parseRestorePurgedInboxRequest } from "@/modules/payment/public";
import { getStripeInboxRecovery } from "@/shared/infrastructure/composition-root";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
import { isAuthorizedCommerceWorkerRequest } from "@/shared/infrastructure/security/worker-authorization";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isAuthorizedCommerceWorkerRequest(request)) return Response.json({ ok: false }, { status: 401, headers });
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedRequestBody(request, { maxBytes: 1_024, timeoutMs: 5_000 }))); } catch { return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers }); }
    const result = await getStripeInboxRecovery().execute(parseRestorePurgedInboxRequest(body));
    return Response.json({ ok: result.outcome === "RESTORED", ...result }, { headers });
  } catch (error) {
    if (error instanceof InvalidFailedInboxRequeueRequestError) return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers });
    reportUnexpectedError(error, { operation: "restore_purged_inbox_event" });
    return Response.json({ ok: false }, { status: 500, headers });
  }
}
