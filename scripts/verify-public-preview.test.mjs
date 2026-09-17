import { describe, it, expect } from "vitest";
import { previewOrigin, verifyHealth, productLinks, verifyCatalogSearch, verifyPreviewSafety, verifyDocument } from "./verify-public-preview.mjs";
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
    expect(verifyHealth({status:'ok',release:'a'.repeat(40)})).toBe('a'.repeat(40));
    for (const value of [{status:'ok',release:'unknown'}, {status:'failed',release:'a'.repeat(40)}, {}, null]) expect(() => verifyHealth(value)).toThrow();
  });
  it("keeps preview disclosures and security headers mandatory", () => {
    const home = 'プレビュー版・注文と決済は発生しません', cart = '<div data-checkout-page="cart">', payment = '<div data-checkout-page="test-payment">実カード情報を入力せず', legal = '現在は Preview 版のため販売を行っていません';
    const headers = new Headers({'x-content-type-options':'nosniff','x-frame-options':'DENY'});
    expect(() => verifyPreviewSafety(home,cart,payment,legal,headers)).not.toThrow();
    expect(() => verifyPreviewSafety(`<script>${home}</script>`,cart,payment,legal,headers)).toThrow();
    expect(() => verifyPreviewSafety(home,cart,payment,legal,new Headers())).toThrow();
    expect(() => verifyPreviewSafety(home,cart,'決済',legal,headers)).toThrow();
    expect(() => verifyPreviewSafety(home,cart,payment,'販売中',headers)).toThrow();
  });
});
