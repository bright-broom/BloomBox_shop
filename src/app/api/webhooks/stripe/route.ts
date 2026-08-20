import { InvalidProviderWebhookError } from "@/modules/payment/public";
import { getStripeWebhookReceiver } from "@/shared/infrastructure/composition-root";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";

export const runtime = "nodejs";
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ received: false }, { status: 400 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return Response.json({ received: false }, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return Response.json({ received: false }, { status: 413 });
  }

  try {
    const result = await getStripeWebhookReceiver().execute(rawBody, signature);
    return Response.json({ received: true, duplicate: result === "DUPLICATE" });
  } catch (error) {
    if (error instanceof InvalidProviderWebhookError) {
      return Response.json({ received: false }, { status: 400 });
    }
    reportUnexpectedError(error, { operation: "receive_stripe_webhook" });
    return Response.json({ received: false }, { status: 500 });
  }
}
