import { InvalidPostalCodeError } from "@/modules/fulfillment/public";
import { postalCodeLookupRequestSchema } from "@/modules/fulfillment/presentation/postal-code-api-schema";
import { application } from "@/shared/infrastructure/composition-root";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 256;
const responseHeaders = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request): Promise<Response> {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return errorResponse("invalid_postal_code", "このリクエストは受け付けられません。", 403);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return errorResponse("invalid_postal_code", "郵便番号を正しく入力してください。", 413);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return errorResponse("invalid_postal_code", "郵便番号を正しく入力してください。", 415);
  }

  let payload: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
      return errorResponse("invalid_postal_code", "郵便番号を正しく入力してください。", 413);
    }
    payload = JSON.parse(body);
  } catch {
    return errorResponse("invalid_postal_code", "郵便番号を正しく入力してください。", 400);
  }
  const parsed = postalCodeLookupRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse("invalid_postal_code", "郵便番号を正しく入力してください。", 400);
  }

  try {
    const result = await application.lookupPostalCode.execute(parsed.data.postalCode);
    if (result.addresses.length === 0) {
      return errorResponse(
        "not_found",
        "郵便番号に一致する住所が見つかりません。入力内容をご確認ください。",
        404,
      );
    }
    return Response.json({ ok: true, ...result }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof InvalidPostalCodeError) {
      return errorResponse("invalid_postal_code", error.message, 400);
    }
    const errorId = reportUnexpectedError(error, { operation: "lookup_postal_code" });
    return errorResponse(
      "temporarily_unavailable",
      `住所の自動入力を一時的に利用できません。住所を手入力してください。（エラー ID: ${errorId}）`,
      503,
    );
  }
}

function errorResponse(
  code: "invalid_postal_code" | "not_found" | "temporarily_unavailable",
  message: string,
  status: number,
): Response {
  return Response.json({ ok: false, code, message }, { status, headers: responseHeaders });
}
