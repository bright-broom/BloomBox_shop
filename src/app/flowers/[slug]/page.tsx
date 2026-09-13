import { SizeComparison } from "@/ui/size-comparison";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { application } from "@/shared/infrastructure/composition-root";
import { formatMoney, money } from "@/shared/domain/money";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSiteUrlConfig } from "@/shared/infrastructure/config/site-url-config";
import {
  createProductStructuredData,
  serializeStructuredData,
} from "@/shared/infrastructure/seo/structured-data";
import { ProductCard } from "@/ui/product-card";
import { cache } from "react";

type ProductPageProps = { params: Promise<{ slug: string }> };
const getProductBySlug = cache((slug: string) => application.getProduct.bySlug(slug));
const listProducts = cache(() => application.listProducts.execute());

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  return product ? {
    title: product.name,
    robots: product.previewOffer ? { index: false, follow: false } : undefined,
    description: product.description,
    alternates: { canonical: `/flowers/${product.slug}` },
    openGraph: {
      type: "website",
      title: product.name,
      description: product.description,
      images: [{ url: product.imageUrl, alt: product.imageAlt }],
    },
  } : {};
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const relatedProducts = (await listProducts())
    .filter((candidate) => candidate.id !== product.id
      && candidate.occasion.some((occasion) => product.occasion.includes(occasion)))
    .slice(0, 2);
  const jsonLd = createProductStructuredData(product, loadSiteUrlConfig().origin);

  return (
    <article>
      {!product.previewOffer ? <script
        type="application/ld+json"
      >
        {serializeStructuredData(jsonLd)}
      </script> : null}
      <div className="detail-page">
        <div className={`detail-image${product.previewOffer ? " is-package" : ""}`}>
        <Image
          src={product.imageUrl}
          alt={product.imageAlt}
          fill
          priority
          sizes="(max-width: 959px) 100vw, 54vw"
        />
        <Link className="back-link" href="/flowers">← 一覧へ</Link>
        </div>
        <div className="detail-copy">
        <nav className="breadcrumbs detail-breadcrumbs" aria-label="パンくずリスト">
          <Link href="/">ホーム</Link><span aria-hidden="true">/</span>
          <Link href="/flowers">季節の花</Link><span aria-hidden="true">/</span>
          <span>{product.name}</span>
        </nav>
        <div className="detail-kicker">
          <p className="eyebrow">{product.palette}</p>
          <span className={`availability-badge${product.available ? "" : " is-unavailable"}`}>
            <i aria-hidden="true" /> {product.available ? "ご注文受付中" : "ただいま入荷待ち"}
          </span>
        </div>
        <h1>{product.name}</h1>
        <p className="detail-subtitle">{product.subtitle}</p>
        <p className="detail-description">{product.description}</p>
        <div className="detail-price">{formatMoney(product.price)} <small>{product.previewOffer ? giftExperienceContent.launch.taxNote : "税込・送料別"}</small></div>
        {product.shippingAmount !== undefined && !product.previewOffer ? <p className="field-note">
          {giftExperienceContent.launch.shippingLabel} {formatMoney(money(product.shippingAmount))} · {giftExperienceContent.launch.totalLabel} {formatMoney(money(product.price.amount + product.shippingAmount))}
        </p> : null}
        {product.available ? (
          <>
            <Link className="primary-button" href={`/gift/${product.id}`}>
              この花を贈る <span aria-hidden="true">→</span>
            </Link>
            {!product.previewOffer ? <ul className="purchase-notes" aria-label="お届けについて">
              <li>最短3日後からお届け</li>
              <li>メッセージカード無料</li>
              <li>安全な外部決済</li>
            </ul> : <p className="field-note">{giftExperienceContent.launch.details}</p>}
            <p className="purchase-policy-links">
              <Link href="/guide">ご利用ガイド</Link>
              <Link href="/shipping-returns">配送・返品について</Link>
            </p>
          </>
        ) : (
          <p className="unavailable-note">次回の入荷まで、いましばらくお待ちください。</p>
        )}
        {product.previewOffer ? <SizeComparison products={[product, ...relatedProducts]} selectedId={product.id} /> : null}
        <dl className="detail-list">
          <div><dt>花材</dt><dd>{product.flowers.join("、")}</dd></div>
          <div><dt>つくり手</dt><dd>{product.grower}</dd></div>
          <div><dt>おすすめ</dt><dd>{product.occasion.join(" / ")}</dd></div>
        </dl>
        </div>
      </div>
      {relatedProducts.length > 0 ? (
        <section className="related-products section-shell" aria-labelledby="related-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOU MAY ALSO LIKE</p>
              <h2 id="related-heading">この想いに似合う花</h2>
            </div>
          </div>
          <div className="product-grid">
            {relatedProducts.map((candidate) => (
              <ProductCard key={candidate.id} product={candidate} />
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}
