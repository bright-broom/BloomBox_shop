import { InvalidProviderWebhookError } from "@/modules/payment/public";
import { getShopifyWebhookReceiver } from "@/shared/infrastructure/composition-root";
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
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null && !/^\d+$/.test(declaredLength)) throw new WebhookBodyError(400);
    if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) throw new WebhookBodyError(413);
    const result = await receiver.execute(await readBody(request), headers);
    return Response.json({ received: true, duplicate: result === "DUPLICATE" });
  } catch (error) {
    if (error instanceof WebhookBodyError) return Response.json({ received: false }, { status: error.status });
    if (error instanceof InvalidProviderWebhookError) return Response.json({ received: false }, { status: 400 });
    reportUnexpectedError(error, { operation: "receive_shopify_webhook" });
    return Response.json({ received: false }, { status: 500 });
  }
}

async function readBody(request: Request): Promise<Uint8Array> {
  if (!request.body) throw new WebhookBodyError(400);
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new WebhookBodyError(408)), READ_TIMEOUT_MS);
  });
  const chunks: Uint8Array[] = []; let size = 0; let complete = false;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new WebhookBodyError(413);
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timer);
    if (!complete) {
      // A stalled source can also stall cancellation; cleanup must not defeat the read deadline.
      void reader.cancel().catch(() => { /* Preserve the original body error. */ });
    }
    reader.releaseLock();
  }
}
