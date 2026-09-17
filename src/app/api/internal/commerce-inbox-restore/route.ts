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
    try { body = JSON.parse(await readRecoveryBody(request)); } catch { return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers }); }
    const result = await getStripeInboxRecovery().execute(parseRestorePurgedInboxRequest(body));
    return Response.json({ ok: result.outcome === "RESTORED", ...result }, { headers });
  } catch (error) {
    if (error instanceof InvalidFailedInboxRequeueRequestError) return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers });
    reportUnexpectedError(error, { operation: "restore_purged_inbox_event" });
    return Response.json({ ok: false }, { status: 500, headers });
  }
}

// Kept private to this privileged endpoint; enforce actual streamed bytes even without Content-Length.
async function readRecoveryBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new InvalidFailedInboxRequeueRequestError();
  const chunks: Uint8Array[] = []; let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new InvalidFailedInboxRequeueRequestError()), 5_000); });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1_024) throw new InvalidFailedInboxRequeueRequestError();
      chunks.push(part.value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
