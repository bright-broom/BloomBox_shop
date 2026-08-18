import type { Metadata } from "next";
import { application } from "@/shared/infrastructure/composition-root";
import { ProductCard } from "@/ui/product-card";

export const metadata: Metadata = { title: "季節の花" };

export default async function FlowersPage() {
  const products = await application.listProducts.execute();

  return (
    <section className="catalog-page section-shell">
      <header className="catalog-header">
        <div>
          <p className="eyebrow">SEASONAL COLLECTION</p>
          <h1>気持ちに似合う、<br />今の花。</h1>
        </div>
        <p>
          その季節にいちばん美しい花を、信頼するつくり手から。
          色や形だけでなく、贈る場面まで想像して束ねています。
        </p>
      </header>
      <div className="filter-row" aria-label="商品情報">
        <span>ALL FLOWERS</span>
        <span>{String(products.length).padStart(2, "0")} COLLECTIONS</span>
      </div>
      <div className="product-grid">
        {products.map((product, index) => (
          <ProductCard key={product.id} product={product} index={index} />
        ))}
      </div>
    </section>
  );
}
