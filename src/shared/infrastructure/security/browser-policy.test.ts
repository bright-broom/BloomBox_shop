import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../../proxy";
import { browserPolicy } from "./browser-policy";

describe("browser script boundary", () => {
  it("overwrites attacker-supplied nonce and policy even on prefetch-looking requests", () => {
    const request = new NextRequest("https://shop.example/cart", { headers: {
      "x-nonce": "attacker", "Content-Security-Policy": "script-src * 'unsafe-inline'",
      "next-router-prefetch": "1", purpose: "prefetch",
    } });
    const first = proxy(request), second = proxy(request);
    const nonce = first.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{32}$/);
    expect(nonce).not.toBe(second.headers.get("x-middleware-request-x-nonce"));
    const policy = first.headers.get("Content-Security-Policy");
    expect(policy).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy).toBe(first.headers.get("x-middleware-request-content-security-policy"));
    expect(first.headers.get("Cache-Control")).toContain("no-store");
  });
  it("limits Google form redirects to authentication surfaces", () => {
    for (const path of ["/account/login", "/operations/login", "/api/customer-auth/signin/google", "/api/operator-auth/callback/google"]) {
      expect(browserPolicy("a".repeat(32), path, false)).toContain("form-action 'self' https://accounts.google.com");
    }
    for (const path of ["/cart", "/checkout/test", "/accounting", "/operations-evil"]) {
      expect(browserPolicy("a".repeat(32), path, false)).not.toContain("accounts.google.com");
    }
  });
  it("opens analytics endpoints only when GA4 is configured, and never for staff screens", () => {
    const off = browserPolicy("a".repeat(32), "/", false);
    expect(off).toContain("connect-src 'self';");
    expect(off).toContain("img-src 'self' data: blob:;");
    const on = browserPolicy("a".repeat(32), "/flowers", false, true);
    expect(on).toContain("connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com;");
    expect(on).toContain("img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com;");
    expect(on).toContain(`script-src 'nonce-${"a".repeat(32)}' 'strict-dynamic';`);
    for (const path of ["/operations", "/operations/orders"]) expect(browserPolicy("a".repeat(32), path, false, true)).not.toContain("google-analytics");
    expect(browserPolicy("a".repeat(32), "/operations-evil", false, true)).toContain("google-analytics");
  });
  it("allows eval only in the development server, never a preview production build", () => {
    expect(browserPolicy("a".repeat(32), "/", false)).not.toContain("unsafe-eval");
    expect(browserPolicy("a".repeat(32), "/", true)).toContain("unsafe-eval");
    expect(() => browserPolicy("bad'; script-src *", "/", false)).toThrow();
  });
});
