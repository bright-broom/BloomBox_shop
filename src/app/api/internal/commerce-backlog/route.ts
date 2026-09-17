import { z } from "zod";
import { getCommerceBacklog } from "@/shared/infrastructure/composition-root";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
import { isAuthorizedCommerceWorkerRequest } from "@/shared/infrastructure/security/worker-authorization";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request): Promise<Response> {
  try {
    if (!isAuthorizedCommerceWorkerRequest(request)) return Response.json({ ok: false }, { status: 401, headers });
    const query = new URL(request.url).searchParams;
    const after = query.get("after") ?? undefined;
    if ([...query.keys()].some((key) => key !== "after") || query.getAll("after").length > 1
      || (after !== undefined && !z.string().uuid().safeParse(after).success)) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers });
    }
    return Response.json({ ok: true, ...await getCommerceBacklog().execute(after) }, { headers });
  } catch (error) {
    reportUnexpectedError(error, { operation: "inspect_commerce_backlog" });
    return Response.json({ ok: false }, { status: 500, headers });
  }
}
