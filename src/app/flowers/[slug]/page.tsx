import { application } from "@/shared/infrastructure/composition-root";
import { formatMoney } from "@/shared/domain/money";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

type ProductPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await application.getProduct.bySlug(slug);
  return product ? { title: product.name, description: product.description } : {};
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await application.getProduct.bySlug(slug);
  if (!product) notFound();

  return (
    <article className="detail-page">
      <div className="detail-image">
        <Image
          src={product.imageUrl}
          alt={product.imageAlt}
          fill
          priority
          sizes="(max-width: 760px) 100vw, 54vw"
        />
        <Link className="back-link" href="/flowers">← 一覧へ</Link>
      </div>
      <div className="detail-copy">
        <p className="eyebrow">{product.palette}</p>
        <h1>{product.name}</h1>
        <p className="detail-subtitle">{product.subtitle}</p>
        <p className="detail-description">{product.description}</p>
        <div className="detail-price">{formatMoney(product.price)} <small>税込・送料別</small></div>
        <Link className="primary-button" href={`/gift/${product.id}`}>
          この花を贈る <span aria-hidden="true">→</span>
        </Link>
        <dl className="detail-list">
          <div><dt>FLOWERS</dt><dd>{product.flowers.join("、")}</dd></div>
          <div><dt>GROWER</dt><dd>{product.grower}</dd></div>
          <div><dt>OCCASION</dt><dd>{product.occasion.join(" / ")}</dd></div>
        </dl>
      </div>
    </article>
  );
}
