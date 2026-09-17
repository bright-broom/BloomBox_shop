import { InvalidProviderWebhookError } from "@/modules/payment/public";
import { getShopifyWebhookReceiver } from "@/shared/infrastructure/composition-root";
import { readBoundedRequestBody, RequestBodyError } from "@/shared/infrastructure/http/bounded-request-body";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 1_000_000;
const READ_TIMEOUT_MS = 2_000;
class WebhookBodyError extends Error {
  constructor(readonly status: number) { super("Invalid webhook body"); this.name = "WebhookBodyError"; }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const receiver = getShopifyWebhookReceiver();
    if (!receiver) return Response.json({ received: false }, { status: 503 });
    const headers = {
      signature: request.headers.get("x-shopify-hmac-sha256"), shop: request.headers.get("x-shopify-shop-domain"),
      topic: request.headers.get("x-shopify-topic"), apiVersion: request.headers.get("x-shopify-api-version"),
    };
    if (!headers.signature || !headers.shop || !headers.topic || !headers.apiVersion) throw new WebhookBodyError(400);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new WebhookBodyError(415);
    const result = await receiver.execute(await readBoundedRequestBody(request, { maxBytes: MAX_BODY_BYTES, timeoutMs: READ_TIMEOUT_MS }), headers);
    return Response.json({ received: true, duplicate: result === "DUPLICATE" });
  } catch (error) {
    if (error instanceof WebhookBodyError || error instanceof RequestBodyError) return Response.json({ received: false }, { status: error.status });
    if (error instanceof InvalidProviderWebhookError) return Response.json({ received: false }, { status: 400 });
    reportUnexpectedError(error, { operation: "receive_shopify_webhook" });
    return Response.json({ received: false }, { status: 500 });
  }
}
