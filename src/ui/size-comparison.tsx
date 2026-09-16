import Link from "next/link";
import Image from "next/image";
import type { Product } from "@/modules/catalog/public";
import { formatMoney, money } from "@/shared/domain/money";
import { previewTotals } from "@/modules/checkout/public";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { PreviewMetric } from "@/ui/preview-metric";
import type { HomeContent } from "@/shared/infrastructure/content/home-content";

export function SizeComparison({ products, selectedId, guidance }: { products: readonly Product[]; selectedId?: string; guidance?: HomeContent["comparison"] }) {
  const options = products.filter((product) => product.previewOffer);
  if (!options.length) return null;
  const copy = giftExperienceContent.launch;
  return <section className="size-comparison" aria-label={copy.sizeLabel}>
    <h2>{copy.title}</h2><p>{copy.lead}</p>
    <p className="checkout-notice">{copy.notice}</p>
    {guidance && options.some((product) => !guidance.sizes.some((item) => item.size === product.previewOffer!.size && item.status === "approved")) ? <details className="home-comparison-guide"><summary>{guidance.title}</summary>
      <p>{guidance.pending}</p>
    </details> : null}
    <div className="size-options">{options.map((product) => {
      const totals = previewTotals(product.price.amount, product.previewOffer!.shippingAmount);
      const detail = guidance?.sizes.find((item) => item.size === product.previewOffer!.size && item.status === "approved");
      return <article className="size-option" key={product.id}>
        <PreviewMetric event={{ name: "product_view", productId: product.id }} />
        <Link className="size-option-image" href={`/flowers/${product.slug}`} aria-label={`${product.name}の詳細を見る`}>
          <Image src={product.imageUrl} alt={product.imageAlt} fill sizes="(max-width: 767px) 100vw, 50vw" />
        </Link>
        <h3>{product.name}</h3>
        {detail ? <div className="home-size-facts"><p>{detail.description}</p><dl>{detail.facts.map((fact) =>
          <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></div> : null}
        <dl className="checkout-details">
          <div><dt>{copy.productLabel}</dt><dd>{formatMoney(product.price)}</dd></div>
          <div><dt>{copy.shippingLabel}</dt><dd>{formatMoney(money(totals.shippingAmount))}</dd></div>
          <div><dt>{copy.totalLabel}</dt><dd><strong>{formatMoney(money(totals.totalAmount))}</strong></dd></div>
        </dl>
        <p className="field-note">{copy.details}</p>
        <Link className="primary-button" href={`/gift/${product.id}`} aria-current={selectedId === product.id ? "true" : undefined}>{product.previewOffer!.size} — {copy.action}<span aria-hidden="true">→</span></Link>
      </article>;
    })}</div>
  </section>;
}
