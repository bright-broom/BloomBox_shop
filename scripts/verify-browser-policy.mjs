import assert from "node:assert/strict";
import { parse } from "parse5";

/** Read-only inspection: parse as HTML instead of executing untrusted page scripts. */
export function verifyBrowserPolicy(html, headers, pathname = "/") {
  const policy = headers.get("content-security-policy");
  assert(policy && !policy.includes(","), "Missing or ambiguous enforced CSP");
  const directives = new Map();
  for (const part of policy.split(";").map((value) => value.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    assert(!directives.has(name), "Duplicate CSP directive");
    directives.set(name, values);
  }
  const script = directives.get("script-src") ?? [];
  const nonceSource = script.find((value) => /^'nonce-[A-Za-z0-9+/]{32}'$/.test(value));
  assert(nonceSource && script.length === 2 && script.includes("'strict-dynamic'"), "Script policy is weakened");
  const nonce = nonceSource.slice(7, -1);
  assert(!directives.has("script-src-elem"), "Unexpected script policy override");
  for (const [name, expected] of Object.entries({
    "default-src": ["'self'"], "connect-src": ["'self'"], "script-src-attr": ["'none'"],
    "object-src": ["'none'"], "base-uri": ["'none'"], "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"], "worker-src": ["'none'"],
    "img-src": ["'self'", "data:", "blob:"], "font-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "form-action": /^\/(account|operations)(\/|$)|^\/api\/(customer-auth|operator-auth)(\/|$)/.test(pathname)
      ? ["'self'", "https://accounts.google.com"] : ["'self'"],
  })) assert(JSON.stringify(directives.get(name)) === JSON.stringify(expected), `Unexpected ${name} policy`);
  assert(headers.get("cache-control")?.includes("no-store"), "Nonce HTML must not be cached");
  const sources = new Set();
  function visit(node) {
    const attrs = new Map((node.attrs ?? []).map(({ name, value }) => [name, value]));
    assert(!(node.attrs ?? []).some(({ name }) => /^on/i.test(name)), "Inline event handler detected");
    if (node.tagName === "script") {
      const type = (attrs.get("type") ?? "").toLowerCase().trim();
      if (type === "application/ld+json") {
        assert(!attrs.has("src"), "Unexpected structured-data source");
        try { JSON.parse((node.childNodes ?? []).map((child) => child.value ?? "").join("")); }
        catch { throw new Error("Invalid structured data"); }
      } else {
        assert(["", "text/javascript", "application/javascript", "module"].includes(type), "Unexpected script type");
        assert(attrs.get("nonce") === nonce, "Script nonce does not match response");
        if (attrs.has("src")) {
          const src = attrs.get("src");
          // Fixed same-origin Next build assets only; reject encoded paths, redirects and queries.
          assert(/^\/_next\/static\/[A-Za-z0-9_./-]+\.js$/.test(src) && !src.includes(".."), "Unapproved script source");
          sources.add(src);
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(parse(html));
  assert(sources.size > 0, "Framework scripts are missing");
  return { nonce, sources: [...sources] };
}
