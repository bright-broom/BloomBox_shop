import { browserPolicy } from "../src/shared/infrastructure/security/browser-policy";
import { describe, it, expect, afterEach, vi } from "vitest";
import { previewOrigin, verifyHealth, productLinks, verifyCatalogSearch, verifyPreviewSafety, verifyCommercialSafety, verifyDocument, verifyPublicPreview, PUBLIC_COMMERCIAL_ROUTES, PUBLIC_PREVIEW_ROUTES, TEST_CHECKOUT_ROUTES } from "./verify-public-preview.mjs";
const matching = '<main><h1>すべての季節の花</h1><a href="/flowers/bloom-box-m">M</a><a href="/flowers/bloom-box-m">詳細</a></main>';
const empty = '<main><h1>季節の花</h1><div role="status">該当する花がありません</div></main>';
describe("public preview smoke contracts", () => {
  it("requires route structure while allowing the real receipt-loading SSR state", () => {
    expect(() => verifyDocument('/cart','<main><h1>カート</h1></main>')).not.toThrow();
    expect(() => verifyDocument('/cart','<main>server error</main>')).toThrow();
    expect(() => verifyDocument('/checkout/test/complete','<main><section data-checkout-page="test-complete"><p role="status">確認中</p></section></main>')).not.toThrow();
    expect(() => verifyDocument('/checkout/test/complete','<main><h1>エラー</h1></main>')).toThrow();
  });
  it("checks actual rendered products, independent of heading copy and duplicate card links", () => {
    expect(() => verifyCatalogSearch(matching, empty)).not.toThrow();
    expect([...productLinks(matching + '<script>"<a href=\'/flowers/bloom-box-l\'>L</a>"</script>')]).toEqual(["/flowers/bloom-box-m"]);
  });
  it.each([matching + '<a href="/flowers/bloom-box-l">L</a>', '<a href="/flowers/bloom-box-l">L</a>', '<script><a href="/flowers/bloom-box-m">M</a></script>', ''])('rejects a broken M search', (html) => {
    expect(() => verifyCatalogSearch(html, empty)).toThrow();
  });
  it("requires an accessible empty result and rejects ignored filters", () => {
    expect(() => verifyCatalogSearch(matching, matching)).toThrow();
    expect(() => verifyCatalogSearch(matching, '<main>error</main>')).toThrow();
  });
  it.each(['http://site.example', 'https://user:secret@site.example', 'https://site.example/path', 'https://site.example?url=evil', 'https://site.example/#other', undefined])("rejects unsafe target %s", (url) => {
    expect(() => previewOrigin(url)).toThrow();
  });
  it("accepts a HTTPS origin and requires actual revision evidence", () => {
    expect(previewOrigin('https://site.example/')).toBe('https://site.example');
    expect(verifyHealth({status:'ok',release:'a'.repeat(40),commerce:'paused'})).toEqual({release:'a'.repeat(40),commerce:'paused'});
    for (const value of [{status:'ok',release:'unknown',commerce:'paused'}, {status:'failed',release:'a'.repeat(40),commerce:'paused'},
      {status:'ok',release:'a'.repeat(40)}, {status:'ok',release:'a'.repeat(40),commerce:'maybe'}, {}, null]) expect(() => verifyHealth(value)).toThrow();
  });
  it("keeps preview disclosures and security headers mandatory", () => {
    const home = 'プレビュー版・注文と決済は発生しません', cart = '<div data-checkout-page="cart">', payment = '<div data-checkout-page="test-payment">実カード情報を入力せず', legal = '記載内容は販売開始前の暫定版です。現在は販売を行っていません。';
    const headers = new Headers({'x-content-type-options':'nosniff','x-frame-options':'DENY'});
    expect(() => verifyPreviewSafety(home,cart,payment,legal,headers)).not.toThrow();
    expect(() => verifyPreviewSafety(`<script>${home}</script>`,cart,payment,legal,headers)).toThrow();
    expect(() => verifyPreviewSafety(home,cart,payment,legal,new Headers())).toThrow();
    expect(() => verifyPreviewSafety(home,cart,'決済',legal,headers)).toThrow();
    expect(() => verifyPreviewSafety(home,cart,payment,'販売中',headers)).toThrow();
  });

  it("switches to the selling contract: no rehearsal wording, complete legal disclosure, purchase terms in the cart", () => {
    const home = '<main><h1>BloomBox</h1></main>';
    const cart = '<div data-checkout-page="cart">ご注文前にご確認ください</div>';
    const legal = ['販売業者', '所在地', '電話番号', '支払時期', 'キャンセル', '返品・交換'].join("：確定済み。");
    const headers = new Headers({'x-content-type-options':'nosniff','x-frame-options':'DENY'});
    expect(() => verifyCommercialSafety(home,cart,legal,headers)).not.toThrow();
    // Anything that says the shop is not selling, or is still a rehearsal, must fail while money can move.
    expect(() => verifyCommercialSafety(home + 'プレビュー版・注文と決済は発生しません',cart,legal,headers)).toThrow();
    expect(() => verifyCommercialSafety(home + '<strong>TEST MODE</strong>',cart,legal,headers)).toThrow();
    expect(() => verifyCommercialSafety(home,cart,legal + '記載内容は販売開始前の暫定版です。',headers)).toThrow();
    expect(() => verifyCommercialSafety(home,cart,legal.replace('電話番号','連絡先'),headers)).toThrow();
    expect(() => verifyCommercialSafety(home,'<div data-checkout-page="cart"></div>',legal,headers)).toThrow();
    expect(() => verifyCommercialSafety(home,cart,legal,new Headers())).toThrow();
  });

  it("excludes the rehearsal routes from the selling route list", () => {
    expect(PUBLIC_COMMERCIAL_ROUTES).toEqual(PUBLIC_PREVIEW_ROUTES.filter((path) => !TEST_CHECKOUT_ROUTES.includes(path)));
    expect(TEST_CHECKOUT_ROUTES.every((path) => PUBLIC_PREVIEW_ROUTES.includes(path))).toBe(true);
  });
});

// Exercise the real fetch/validation sequence: valid catalog links alone must not
// allow a search response to bypass document and browser-policy checks.
describe("public preview search responses", () => {
  afterEach(() => vi.unstubAllGlobals());
  const searchPaths = ["/flowers?q=BLOOM%20BOX%20M", "/flowers?q=__bloombox_smoke_no_match_29482__"];
  function serve(change = () => {}, commerce = "paused") {
    const nonce = "a".repeat(32);
    const fetchMock = vi.fn(async (url) => {
      const path = url.slice("https://site.example".length);
      if (path === "/api/health") return new Response(JSON.stringify({ status: "ok", release: "a".repeat(40), commerce }));
      let body = '<main><h1>BloomBox</h1></main>';
      if (path === "/" && commerce !== "open") body += "プレビュー版・注文と決済は発生しません";
      if (path === "/cart") body += '<div data-checkout-page="cart"></div>';
      if (path === "/checkout/test/payment") body += '<div data-checkout-page="test-payment">実カード情報を入力せず</div>';
      if (path === "/checkout/test/complete") body += '<div data-checkout-page="test-complete" role="status"></div>';
      if (path === "/commercial-transactions") {
        body += commerce === "open"
          ? "販売業者 所在地 電話番号 支払時期 キャンセル 返品・交換"
          : "記載内容は販売開始前の暫定版です。現在は販売を行っていません。";
      }
      if (path === "/cart" && commerce === "open") body += "ご注文前にご確認ください";
      if (path === searchPaths[0]) body = matching;
      if (path === searchPaths[1]) body = empty;
      body += `<script nonce="${nonce}" src="/_next/static/chunks/app.js"></script>`;
      const page = { body, headers: new Headers({
        "content-security-policy": browserPolicy(nonce, path, false),
        "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY",
      }) };
      change(path, page);
      return new Response(page.status === 404 ? "" : page.body, { status: page.status ?? 200, headers: page.headers });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  it("validates the full read-only route sequence and both search outcomes", async () => {
    const fetchMock = serve();
    await expect(verifyPublicPreview("https://site.example", () => {})).resolves.toBe("a".repeat(40));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(
      ["/api/health", ...PUBLIC_PREVIEW_ROUTES, ...searchPaths].map((path) => `https://site.example${path}`),
    );
  });

  it("checks the selling contract and requires the rehearsal routes to be gone once commerce is open", async () => {
    const fetchMock = serve((path, page) => {
      if (TEST_CHECKOUT_ROUTES.includes(path)) { page.status = 404; }
    }, "open");
    await expect(verifyPublicPreview("https://site.example", () => {})).resolves.toBe("a".repeat(40));
    const requested = fetchMock.mock.calls.map(([url]) => url.slice("https://site.example".length));
    expect(requested).toEqual(["/api/health", ...PUBLIC_COMMERCIAL_ROUTES, ...TEST_CHECKOUT_ROUTES, ...searchPaths]);
  });

  it("fails while selling when a rehearsal route is still reachable", async () => {
    serve(() => {}, "open");
    await expect(verifyPublicPreview("https://site.example", () => {})).rejects.toThrow(/must not be reachable/);
  });
  it.each(searchPaths)("rejects invalid search responses at %s", async (target) => {
    for (const corrupt of [
      (page) => page.headers.delete("content-security-policy"),
      (page) => { page.body += '<script src="https://unapproved.invalid/script.js"></script>'; },
      (page) => { page.body = page.body.replace(/<\/?h1>/g, ""); },
    ]) {
      serve((path, page) => { if (path === target) corrupt(page); });
      const log = vi.fn();
      await expect(verifyPublicPreview("https://site.example", log)).rejects.toThrow();
      expect(log.mock.calls.some(([line]) => line.includes("PASS catalog filtering"))).toBe(false);
    }
  });
});
