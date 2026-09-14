import type { Product } from "@/modules/catalog/public";
import { formatMoney } from "@/shared/domain/money";
import Image from "next/image";
import Link from "next/link";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";

export function ProductCard({ product, headingLevel = 3 }: { product: Product; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="product-card">
      <Link className={`product-image-wrap${product.previewOffer ? " is-package" : ""}`} href={`/flowers/${product.slug}`} aria-label={`${product.name}の詳細を見る`}>
        <Image
          className="product-image"
          src={product.imageUrl}
          alt={product.imageAlt}
          fill
          sizes="(max-width: 519px) calc(100vw - 48px), (max-width: 959px) calc((100vw - 80px) / 2), calc((100vw - 160px) / 3)"
        />
        <span className="product-arrow" aria-hidden="true">
          ↗
        </span>
      </Link>
      <div className="product-meta">
        <div>
          <p className="eyebrow">{product.palette}</p>
          <Heading>
            <Link href={`/flowers/${product.slug}`}>{product.name}</Link>
          </Heading>
          <p>{product.subtitle}</p>
          <ul className="occasion-list" aria-label="おすすめの贈る場面">
            {product.occasion.slice(0, 2).map((occasion) => (
              <li key={occasion}>{occasion}</li>
            ))}
          </ul>
        </div>
        <p className="price">{formatMoney(product.price)} <small>{product.previewOffer ? giftExperienceContent.launch.taxNote : "税込"}</small></p>
      </div>
    </article>
  );
}
