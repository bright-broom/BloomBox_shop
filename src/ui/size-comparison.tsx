import Link from "next/link";
import type { Product } from "@/modules/catalog/public";
import { formatMoney, money } from "@/shared/domain/money";
import { previewTotals } from "@/modules/checkout/public";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { PreviewMetric } from "@/ui/preview-metric";

export function SizeComparison({ products, selectedId }: { products: readonly Product[]; selectedId?: string }) {
  const options = products.filter((product) => product.previewOffer);
  if (!options.length) return null;
  const copy = giftExperienceContent.launch;
  return <section className="size-comparison" aria-label={copy.sizeLabel}>
    <h2>{copy.title}</h2><p>{copy.lead}</p>
    <p className="checkout-notice">{copy.notice}</p>
    <div className="size-options">{options.map((product) => {
      const totals = previewTotals(product.price.amount, product.previewOffer!.shippingAmount);
      return <article className="size-option" key={product.id}>
        <PreviewMetric event={{ name: "product_view", productId: product.id }} />
        <h3>{product.name}</h3>
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
