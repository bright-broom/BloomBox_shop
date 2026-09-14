import { createHash, timingSafeEqual } from "node:crypto";
import { deliverAdvertising, cleanAdvertising } from "@/shared/infrastructure/advertising-runtime";
import { loadCommerceWorkerSecret } from "@/shared/infrastructure/config/worker-config";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const expected = `Bearer ${loadCommerceWorkerSecret()}`; const actual = request.headers.get("authorization") ?? "";
    if (!timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(actual).digest())) return Response.json({ ok: false }, { status: 401 });
    const result = new URL(request.url).searchParams.get("mode") === "retention"
      ? (await cleanAdvertising(), { retention: true }) : await deliverAdvertising();
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { reportUnexpectedError(error, { operation: "advertising_worker" }); return Response.json({ ok: false }, { status: 500 }); }
}
