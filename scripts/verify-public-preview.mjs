import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { verifyBrowserPolicy } from "./verify-browser-policy.mjs";

export const TEST_CHECKOUT_ROUTES = ["/checkout/test", "/checkout/test/review", "/checkout/test/payment", "/checkout/test/complete"];
/** Preview fixture products. A real catalog has its own slugs, so these are checked only while paused. */
export const PREVIEW_PRODUCT_ROUTES = ["/flowers/bloom-box-m", "/flowers/bloom-box-l", "/gift/prod_bloombox_m", "/gift/prod_bloombox_l"];
const INFORMATION_ROUTES = ["/about", "/guide", "/faq", "/shipping-returns", "/privacy", "/terms", "/commercial-transactions", "/contact", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest"];
export const PUBLIC_PREVIEW_ROUTES = ["/", "/flowers", ...PREVIEW_PRODUCT_ROUTES, "/cart", ...TEST_CHECKOUT_ROUTES, ...INFORMATION_ROUTES];
/** While selling, the rehearsal must be gone and the products come from the live catalog, not from fixtures. */
export const PUBLIC_COMMERCIAL_ROUTES = ["/", "/flowers", "/cart", ...INFORMATION_ROUTES];

export function previewOrigin(value) {
  const url = new URL(value);
  assert(url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "PRODUCTION_BASE_URL must be a credential-free HTTPS origin");
  return url.origin;
}
export function verifyHealth(value) {
  assert(value?.status === "ok" && typeof value.release === "string" && /^[0-9a-f]{40}$/.test(value.release), "Health must expose an ok status and full release SHA");
  // The deployment states whether it accepts purchases; the monitor then checks that state's contract.
  assert(value.commerce === "open" || value.commerce === "paused", "Health must state whether commerce is open or paused");
  return { release: value.release, commerce: value.commerce };
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
/** Whatever the catalog holds, an impossible term must render no product and an accessible empty state. */
export function verifyEmptyCatalogSearch(emptyHtml) {
  assert(productLinks(emptyHtml).size === 0, "A non-matching search must render no product links");
  assert(/role=["']status["']/.test(renderedHtml(emptyHtml)), "A non-matching search must render an accessible empty state");
}
export function verifyCatalogSearch(matchingHtml, emptyHtml) {
  const matching = productLinks(matchingHtml), empty = productLinks(emptyHtml);
  assert(matching.size === 1 && matching.has("/flowers/bloom-box-m"), "M search must render only the M product, regardless of heading copy");
  assert(empty.size === 0, "A non-matching search must render no product links");
  assert(/role=["']status["']/.test(renderedHtml(emptyHtml)), "A non-matching search must render an accessible empty state");
}
export function verifySecurityHeaders(headers) {
  assert(headers.get("x-content-type-options")?.toLowerCase() === "nosniff", "nosniff header is missing");
  assert(headers.get("x-frame-options")?.toLowerCase() === "deny", "Frame denial header is missing");
}
/**
 * The selling contract. Commercial copy is the seller's to write, so this checks what must hold whenever
 * money can change hands: no rehearsal or non-selling statements, and the disclosures a buyer needs.
 */
export function verifyCommercialSafety(home, cart, legal, headers) {
  const [homeMarkup, cartMarkup, legalMarkup] = [home, cart, legal].map(renderedHtml);
  for (const [name, markup] of [["home", homeMarkup], ["cart", cartMarkup], ["legal", legalMarkup]]) {
    assert(!markup.includes("プレビュー版・注文と決済は発生しません"), `Preview disclosure is still shown while selling on the ${name} page`);
    assert(!/TEST MODE|ダミー決済|実際の注文・請求・配送は発生しません/.test(markup), `Rehearsal wording is still shown while selling on the ${name} page`);
  }
  assert(!legalMarkup.includes("現在は Preview 版のため販売を行っていません"), "Non-commercial disclosure is still shown while selling");
  assert(!/販売開始前の暫定版|正式公開前に確定/.test(legalMarkup), "Legal notice is still marked provisional while selling");
  for (const term of ["販売業者", "所在地", "電話番号", "支払時期", "キャンセル", "返品・交換"]) {
    assert(legalMarkup.includes(term), `Required legal disclosure is missing while selling: ${term}`);
  }
  assert(/data-checkout-page=["']cart["']/.test(cartMarkup), "Cart route did not render its expected page");
  assert(cartMarkup.includes("ご注文前にご確認ください"), "Purchase terms are missing from the cart while selling");
  verifySecurityHeaders(headers);
}
export function verifyPreviewSafety(home, cart, payment, legal, headers) {
  // Safety statements remain explicit contracts: changes require a reviewed monitor update.
  assert(renderedHtml(home).includes("プレビュー版・注文と決済は発生しません"), "Preview disclosure is missing");
  assert(/data-checkout-page=["']cart["']/.test(renderedHtml(cart)), "Cart route did not render its expected page");
  assert(/data-checkout-page=["']test-payment["']/.test(renderedHtml(payment)), "Test payment route did not render its expected page");
  assert(renderedHtml(payment).includes("実カード情報を入力せず"), "Test payment card-safety disclosure is missing");
  assert(renderedHtml(legal).includes("現在は販売を行っていません"), "Non-commercial disclosure is missing");
  verifySecurityHeaders(headers);
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
/** The rehearsal routes must answer 404 while selling; a redirect or a rendered page is a failure. */
async function expectNotFound(base, path) {
  const response = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "BloomBox-read-only-smoke" } });
  assert(response.status === 404, `Rehearsal route ${path} must not be reachable while selling (HTTP ${response.status})`);
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
async function getVerifiedPage(base, path) {
  const page = await get(base, path);
  verifyDocument(path, page.body);
  if (!/\.(txt|xml|webmanifest)$/.test(path)) verifyBrowserPolicy(page.body, page.headers, path);
  return page;
}
export async function verifyPublicPreview(origin, log = console.log) {
  const base = previewOrigin(origin);
  const health = await get(base, "/api/health");
  const { release, commerce } = verifyHealth(JSON.parse(health.body));
  log(`Read-only target: ${base}; deployed release: ${release}; commerce: ${commerce}`);
  const pages = new Map();
  for (const path of commerce === "open" ? PUBLIC_COMMERCIAL_ROUTES : PUBLIC_PREVIEW_ROUTES) {
    const page = await getVerifiedPage(base, path);
    pages.set(path, page); log(`PASS ${path}`);
  }
  const home = pages.get("/");
  if (commerce === "open") {
    for (const path of TEST_CHECKOUT_ROUTES) { await expectNotFound(base, path); log(`PASS 404 ${path}`); }
    verifyCommercialSafety(home.body, pages.get("/cart").body, pages.get("/commercial-transactions").body, home.headers);
  } else {
    verifyPreviewSafety(home.body, pages.get("/cart").body, pages.get("/checkout/test/payment").body, pages.get("/commercial-transactions").body, home.headers);
  }
  const empty = await getVerifiedPage(base, "/flowers?q=__bloombox_smoke_no_match_29482__");
  if (commerce === "open") {
    // The live catalog is the seller's; take a product from the listing instead of assuming fixture slugs.
    const listed = [...productLinks(pages.get("/flowers").body)];
    assert(listed.length > 0, "The catalog listing renders no product while selling");
    const product = await getVerifiedPage(base, listed[0]);
    assert(/<h1\b/.test(renderedHtml(product.body)), `Product page is missing its heading at ${listed[0]}`);
    log(`PASS ${listed[0]}`);
    verifyEmptyCatalogSearch(empty.body);
  } else {
    const matching = await getVerifiedPage(base, "/flowers?q=BLOOM%20BOX%20M");
    verifyCatalogSearch(matching.body, empty.body);
  }
  log(`PASS catalog filtering and the ${commerce === "open" ? "selling" : "non-selling"} contract; release ${release}`);
  return release;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPublicPreview(process.env.PRODUCTION_BASE_URL).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
