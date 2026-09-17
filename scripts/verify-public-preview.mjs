import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const PUBLIC_PREVIEW_ROUTES = ["/", "/flowers", "/flowers/bloom-box-m", "/flowers/bloom-box-l", "/gift/prod_bloombox_m", "/gift/prod_bloombox_l", "/cart", "/checkout/test", "/checkout/test/review", "/checkout/test/payment", "/checkout/test/complete", "/about", "/guide", "/faq", "/shipping-returns", "/privacy", "/terms", "/commercial-transactions", "/contact", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest"];

export function previewOrigin(value) {
  const url = new URL(value);
  assert(url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "PRODUCTION_BASE_URL must be a credential-free HTTPS origin");
  return url.origin;
}
export function verifyHealth(value) {
  assert(value?.status === "ok" && typeof value.release === "string" && /^[0-9a-f]{40}$/.test(value.release), "Health must expose an ok status and full release SHA");
  return value.release;
}
/** Inspect rendered markup only, not product references inside Next's hydration scripts. */
export function renderedHtml(html) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
}
export function productLinks(html) {
  const links = new Set();
  for (const tag of renderedHtml(html).matchAll(/<a\b[^>]*>/gi)) {
    const href = tag[0].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (href && /^\/flowers\/[^/?#]+$/.test(href)) links.add(href);
  }
  return links;
}
export function verifyCatalogSearch(matchingHtml, emptyHtml) {
  const matching = productLinks(matchingHtml), empty = productLinks(emptyHtml);
  assert(matching.size === 1 && matching.has("/flowers/bloom-box-m"), "M search must render only the M product, regardless of heading copy");
  assert(empty.size === 0, "A non-matching search must render no product links");
  assert(/role=["']status["']/.test(renderedHtml(emptyHtml)), "A non-matching search must render an accessible empty state");
}
export function verifyPreviewSafety(home, cart, payment, legal, headers) {
  // Safety statements remain explicit contracts: changes require a reviewed monitor update.
  assert(renderedHtml(home).includes("プレビュー版・注文と決済は発生しません"), "Preview disclosure is missing");
  assert(/data-checkout-page=["']cart["']/.test(renderedHtml(cart)), "Cart route did not render its expected page");
  assert(/data-checkout-page=["']test-payment["']/.test(renderedHtml(payment)), "Test payment route did not render its expected page");
  assert(renderedHtml(payment).includes("実カード情報を入力せず"), "Test payment card-safety disclosure is missing");
  assert(renderedHtml(legal).includes("現在は Preview 版のため販売を行っていません"), "Non-commercial disclosure is missing");
  assert(headers.get("x-content-type-options")?.toLowerCase() === "nosniff", "nosniff header is missing");
  assert(headers.get("x-frame-options")?.toLowerCase() === "deny", "Frame denial header is missing");
}
export function verifyDocument(path, html) {
  if (/\.(txt|xml|webmanifest)$/.test(path)) return;
  const markup = renderedHtml(html);
  assert(/<main\b/.test(markup), `Expected main document is missing at ${path}`);
  // Completion starts with a client-side receipt lookup, so its SSR intentionally has no h1.
  if (path === "/checkout/test/complete") {
    assert(/data-checkout-page=["']test-complete["']/.test(markup) && /role=["']status["']/.test(markup), "Expected test-receipt loading state is missing");
  } else assert(/<h1\b/.test(markup), `Expected page heading is missing at ${path}`);
}
async function get(base, path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(base + path, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "BloomBox-read-only-smoke" } });
      assert(response.status === 200, `Unexpected HTTP ${response.status} at ${path}`);
      const body = await response.text();
      assert(body.length > 0, `Empty response at ${path}`);
      return { body, headers: response.headers };
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Unreachable retry state");
}
export async function verifyPublicPreview(origin, log = console.log) {
  const base = previewOrigin(origin);
  const health = await get(base, "/api/health");
  const release = verifyHealth(JSON.parse(health.body));
  log(`Read-only target: ${base}; deployed release: ${release}`);
  const pages = new Map();
  for (const path of PUBLIC_PREVIEW_ROUTES) {
    const page = await get(base, path);
    verifyDocument(path, page.body);
    pages.set(path, page); log(`PASS ${path}`);
  }
  const home = pages.get("/");
  verifyPreviewSafety(home.body, pages.get("/cart").body, pages.get("/checkout/test/payment").body, pages.get("/commercial-transactions").body, home.headers);
  const matching = await get(base, "/flowers?q=BLOOM%20BOX%20M");
  const empty = await get(base, "/flowers?q=__bloombox_smoke_no_match_29482__");
  verifyCatalogSearch(matching.body, empty.body);
  log(`PASS catalog filtering and preview safety; release ${release}`);
  return release;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPublicPreview(process.env.PRODUCTION_BASE_URL).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
