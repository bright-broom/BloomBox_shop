import type { Product } from "@/modules/catalog/domain/product";
import { formatMoney } from "@/shared/domain/money";
import Image from "next/image";
import Link from "next/link";

export function ProductCard({ product, index }: { product: Product; index: number }) {
  return (
    <article className="product-card">
      <Link className="product-image-wrap" href={`/flowers/${product.slug}`}>
        <span className="product-number" aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>
        <Image
          className="product-image"
          src={product.imageUrl}
          alt={product.imageAlt}
          fill
          sizes="(max-width: 760px) 92vw, 30vw"
        />
        <span className="product-arrow" aria-hidden="true">
          ↗
        </span>
        <span className="product-view-label">詳しく見る</span>
      </Link>
      <div className="product-meta">
        <div>
          <p className="eyebrow">{product.palette}</p>
          <h3>
            <Link href={`/flowers/${product.slug}`}>{product.name}</Link>
          </h3>
          <p>{product.subtitle}</p>
          <ul className="occasion-list" aria-label="おすすめの贈る場面">
            {product.occasion.slice(0, 2).map((occasion) => (
              <li key={occasion}>{occasion}</li>
            ))}
          </ul>
        </div>
        <p className="price">{formatMoney(product.price)} <small>税込</small></p>
      </div>
    </article>
  );
}
