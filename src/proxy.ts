import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { browserPolicy } from "./shared/infrastructure/security/browser-policy";

export function proxy(request: NextRequest) {
  const nonce = randomBytes(24).toString("base64");
  const policy = browserPolicy(nonce, request.nextUrl.pathname, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  // A cached document must not reuse a nonce or be paired with a different response nonce.
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export const config = {
  // Do not skip based on client-controlled prefetch headers: a document still needs its policy.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/|fonts/).*)"],
};
