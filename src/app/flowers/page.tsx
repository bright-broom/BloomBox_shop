import { SizeComparison } from "@/ui/size-comparison";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import type { Metadata } from "next";
import { application } from "@/shared/infrastructure/composition-root";
import { ProductCard } from "@/ui/product-card";
import { siteContent } from "@/shared/infrastructure/content/site-content";
import Link from "next/link";
import { z } from "zod";
import { PRODUCT_SEARCH_QUERY_MAX_LENGTH } from "@/modules/catalog/public";

export const metadata: Metadata = {
  title: "季節の花",
  alternates: { canonical: "/flowers" },
};
export const dynamic = "force-dynamic";

const searchSchema = z.object({
  q: z.string().trim().max(PRODUCT_SEARCH_QUERY_MAX_LENGTH).catch(""),
  occasion: z.string().trim().max(40).catch(""),
  sort: z.enum(["featured", "price-asc", "price-desc", "name"]).catch("featured"),
});

type FlowersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FlowersPage({ searchParams }: FlowersPageProps) {
  const raw = await searchParams;
  const criteria = searchSchema.parse({
    q: singleValue(raw.q),
    occasion: singleValue(raw.occasion),
    sort: singleValue(raw.sort),
  });
  const result = await application.searchProducts.execute({
    query: criteria.q,
    occasion: criteria.occasion,
    sort: criteria.sort,
  });
  const launchPreview = result.products.length > 0 && result.products.every((product) => product.previewOffer);

  return (
    <section className="catalog-page section-shell">
      <header className="catalog-header">
        <div>
          <p className="eyebrow">SEASONAL COLLECTION</p>
          <h1>気持ちに似合う、<br />今の花。</h1>
        </div>
        <p>
          {launchPreview ? giftExperienceContent.launch.lead : "その季節にいちばん美しい花を、信頼するつくり手から。色や形だけでなく、贈る場面まで想像して束ねています。"}
        </p>
      </header>
      {!launchPreview ? <form className="catalog-tools" method="get" role="search">
        <div className="catalog-search-field">
          <label htmlFor="catalog-query">花や贈る場面から探す</label>
          <input
            id="catalog-query"
            name="q"
            type="search"
            defaultValue={criteria.q}
            maxLength={PRODUCT_SEARCH_QUERY_MAX_LENGTH}
            placeholder="例：誕生日、チューリップ"
          />
        </div>
        <div className="catalog-select-field">
          <label htmlFor="catalog-occasion">贈る場面</label>
          <select id="catalog-occasion" name="occasion" defaultValue={criteria.occasion}>
            <option value="">すべて</option>
            {result.occasions.map((occasion) => (
              <option key={occasion} value={occasion}>{occasion}</option>
            ))}
          </select>
        </div>
        <div className="catalog-select-field">
          <label htmlFor="catalog-sort">並び順</label>
          <select id="catalog-sort" name="sort" defaultValue={criteria.sort}>
            <option value="featured">おすすめ順</option>
            <option value="price-asc">価格が低い順</option>
            <option value="price-desc">価格が高い順</option>
            <option value="name">商品名順</option>
          </select>
        </div>
        <button className="secondary-button" type="submit">条件を適用</button>
      </form> : null}
      <div className="filter-row" aria-live="polite">
        <span>{result.products.length === result.total ? "すべての季節の花" : "検索結果"}</span>
        <span>{String(result.products.length).padStart(2, "0")} / {String(result.total).padStart(2, "0")} {launchPreview ? "SIZES" : "COLLECTIONS"}</span>
      </div>
      {result.products.some((product) => product.previewOffer) ? <SizeComparison products={result.products} /> : <div className="product-grid">
        {result.products.length > 0 ? result.products.map((product) => (
          <ProductCard key={product.id} product={product} headingLevel={2} />
        )) : (
          <div className="catalog-empty" role="status">
            <p>{result.total === 0 ? siteContent.catalog.emptyMessage : siteContent.catalog.noResultsMessage}</p>
            {result.total > 0 ? <Link className="text-link" href="/flowers">条件をクリア</Link> : null}
          </div>
        )}
      </div>}
    </section>
  );
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
