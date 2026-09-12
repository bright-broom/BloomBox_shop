import { NextRequest } from "next/server";
import { getCustomerAuth, isCustomerOrigin } from "@/shared/infrastructure/security/customer-auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };
async function handle(request: NextRequest) {
  try {
    const service = getCustomerAuth();
    if (!service) return new Response(null, { status: 503, headers: privateHeaders });
    if (!isCustomerOrigin(request, service.config)) return new Response(null, { status: 403, headers: privateHeaders });
    const path = request.nextUrl.pathname;
    const allowed = request.method === "GET" ? ["/csrf", "/providers", "/session", "/signin", "/signin/google", "/callback/google", "/error"]
      : ["/signin/google", "/signout"];
    if (!allowed.some((action) => path === `/api/customer-auth${action}`)) return new Response(null, { status: 404, headers: privateHeaders });
    let bounded = request;
    if (request.method === "POST") {
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") return new Response(null, { status: 415, headers: privateHeaders });
      const reader = request.body?.getReader();
      if (!reader) return new Response(null, { status: 400, headers: privateHeaders });
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8_192) return new Response(null, { status: 413, headers: privateHeaders });
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      bounded = new NextRequest(request.url, { method: "POST", headers: request.headers, body: Buffer.concat(chunks) });
    }
    const response = await (request.method === "GET" ? service.auth.handlers.GET(bounded) : service.auth.handlers.POST(bounded));
    const responseHeaders = new Headers(response.headers);
    for (const [name, value] of Object.entries(privateHeaders)) responseHeaders.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  } catch {
    console.error("customer_auth_route_unavailable");
    return new Response(null, { status: 503, headers: privateHeaders });
  }
}
export const GET = handle;
export const POST = handle;
