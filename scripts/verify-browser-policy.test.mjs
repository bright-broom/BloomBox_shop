import { describe, expect, it } from "vitest";
import { browserPolicy } from "../src/shared/infrastructure/security/browser-policy";
import { verifyBrowserPolicy } from "./verify-browser-policy.mjs";

const nonce = "a".repeat(32);
const html = `<main>表示</main><script nonce="${nonce}" src="/_next/static/chunks/app.js"></script><script nonce="${nonce}">self.__next_f=[]</script>`;
const headers = () => new Headers({ "content-security-policy": browserPolicy(nonce, "/cart", false), "cache-control": "private, no-store" });
describe("delivered document script inspection", () => {
  it("accepts nonce-bound Next assets and inert structured data", () => {
    expect(verifyBrowserPolicy(html + '<script type="application/ld+json">{"name":"BloomBox"}</script>', headers()).sources).toEqual(["/_next/static/chunks/app.js"]);
  });
  it.each([
    '<script src="https://unapproved.invalid/injected.js"></script>',
    `<script nonce="${nonce}" src="https://unapproved.invalid/injected.js"></script>`,
    `<SCRIPT nonce="${nonce}" SRC="&#x2f;&#x2f;unapproved.invalid/injected.js"></SCRIPT>`,
    `<script nonce="${nonce}" src="/_next/static/../api/evil.js"></script>`,
    '<script>window.compromised=true</script>',
    '<img src="/missing" onerror="alert(1)">',
    '<template><script src="https://unapproved.invalid/injected.js"></script></template>',
    '<script type="importmap">{"imports":{}}</script>',
  ])("rejects injected or unapproved markup without executing it: %s", (injected) => {
    expect(() => verifyBrowserPolicy(html + injected, headers())).toThrow();
  });
  it.each([
    (policy) => policy.replace("'strict-dynamic'", "'unsafe-inline'"),
    (policy) => policy + "; script-src-elem *",
    (policy) => policy + "; script-src 'none'",
    (policy) => policy.replace("connect-src 'self'", "connect-src *"),
    () => "base-uri 'self'; form-action 'self'; object-src 'none'",
  ])("rejects weakened or ambiguous policies", (weaken) => {
    const value = headers(); value.set("content-security-policy", weaken(value.get("content-security-policy")));
    expect(() => verifyBrowserPolicy(html, value)).toThrow();
  });
  it("rejects cached HTML, mismatched nonces, missing assets and report-only policy", () => {
    const cached = headers(); cached.set("cache-control", "public, max-age=3600");
    expect(() => verifyBrowserPolicy(html, cached)).toThrow();
    expect(() => verifyBrowserPolicy(html.replaceAll(nonce, "b".repeat(32)), headers())).toThrow();
    expect(() => verifyBrowserPolicy("<main>Error</main>", headers())).toThrow();
    const reportOnly = headers(); reportOnly.set("content-security-policy-report-only", reportOnly.get("content-security-policy")); reportOnly.delete("content-security-policy");
    expect(() => verifyBrowserPolicy(html, reportOnly)).toThrow();
  });
});
