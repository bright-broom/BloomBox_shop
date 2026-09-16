import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogHistoryPanel, type CatalogHistoryResult } from "./catalog-history";
const filters = { productId: "00000000-0000-4000-8000-000000000001", kind: "catalog" as const, before: 20 };
const base = { operatorId: "00000000-0000-4000-8000-000000000002", requestId: "00000000-0000-4000-8000-000000000003", version: 19, occurredAt: "2026-09-17T00:00:00.000Z" };
describe("catalog history presentation", () => {
  it("distinguishes empty, initial and unavailable states without inventing records", () => {
    expect(renderToStaticMarkup(<CatalogHistoryPanel filters={filters} page={null} />)).toContain("確認する商品を選んでください");
    expect(renderToStaticMarkup(<CatalogHistoryPanel filters={filters} page={{kind:"catalog",entries:[],next:null}} />)).toContain("条件に一致する変更履歴はありません");
    const failed = renderToStaticMarkup(<CatalogHistoryPanel filters={filters} page={null} error="読み込めません" />);
    expect(failed).toContain('role="alert"'); expect(failed).not.toContain("確認する商品を選んでください");
  });
  it("escapes historic content, distinguishes unconfigured from free shipping, and preserves filter on next page", () => {
    const page: CatalogHistoryResult = { kind:"catalog", next:10, entries:[{...base,changes:[{field:"name",before:"<script>bad</script>",after:"更新"},{field:"shippingAmount",before:null,after:0},{field:"available",before:true,after:false}]}] };
    const html = renderToStaticMarkup(<CatalogHistoryPanel filters={filters} page={page} />);
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("未設定・登録前");
    expect(html).toContain("￥0"); expect(html).toContain("受付停止"); expect(html).toContain("9:00:00");
    expect(html).toContain(`productId=${filters.productId}&amp;kind=catalog&amp;before=10`);
    expect(html).toContain('htmlFor="history-product"'.replace("htmlFor", "for"));
    expect(html).not.toContain('method="post"');
  });
  it("labels manual adjustments separately from payment reservations and shows signed amounts", () => {
    const html = renderToStaticMarkup(<CatalogHistoryPanel filters={{...filters,kind:"stock"}} page={{kind:"stock",next:null,entries:[{...base,beforeQuantity:9,afterQuantity:7,delta:-2,reason:"CORRECTION"}]}} />);
    expect(html).toContain("数量訂正"); expect(html).toContain("-2"); expect(html).toContain("現在の在庫数ではありません");
  });
});
