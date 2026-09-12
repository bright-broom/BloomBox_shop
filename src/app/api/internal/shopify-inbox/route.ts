import { createHash, timingSafeEqual } from "node:crypto";
import { loadShopifyInboxConfig } from "@/shared/infrastructure/config/shopify-inbox-config";
import { createShopifyInboxProcessor } from "@/shared/infrastructure/shopify-inbox-composition";
import { reportUnexpectedError } from "@/shared/infrastructure/observability/report-unexpected-error";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: Request): Promise<Response> {
  try {
    const config = loadShopifyInboxConfig();
    if (!config) return Response.json({ ok: false }, { status: 503, headers });
    const expected = `Bearer ${config.workerSecret}`;
    const actual = request.headers.get("authorization") ?? "";
    if (!timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest())
      || actual.length !== expected.length) return Response.json({ ok: false }, { status: 401, headers });
    const inbox = await createShopifyInboxProcessor(config).execute();
    if (inbox.failed > 0) throw new ShopifyInboxDeadLetterError();
    return Response.json({ ok: true, inbox }, { headers });
  } catch (error) {
    reportUnexpectedError(error, { operation: "process_shopify_test_inbox" });
    return Response.json({ ok: false }, { status: 500, headers });
  }
}

class ShopifyInboxDeadLetterError extends Error {
  constructor() { super("Shopify inbox event reached terminal failure"); this.name = "ShopifyInboxDeadLetterError"; }
}
