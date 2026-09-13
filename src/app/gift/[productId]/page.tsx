import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { PreviewMetric } from "@/ui/preview-metric";
import { productId } from "@/modules/catalog/public";
import { getEarliestDeliveryDate, getLatestDeliveryDate } from "@/modules/fulfillment/public";
import { application } from "@/shared/infrastructure/composition-root";
import { formatMoney, money } from "@/shared/domain/money";
import { GiftForm } from "@/ui/gift-form";
import { CheckoutProgress } from "@/ui/checkout-progress";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type GiftPageProps = {
  params: Promise<{ productId: string }>;
};

export default async function GiftPage({ params }: GiftPageProps) {
  const { productId: rawProductId } = await params;
  const product = await application.getProduct.byId(productId(rawProductId));
  if (!product) notFound();
  const sizeProducts = product.previewOffer ? (await application.listProducts.execute()).filter((candidate) => candidate.previewOffer?.family === product.previewOffer?.family) : [];
  const sizeOptions = sizeProducts.map((candidate) => ({ id: candidate.id, name: candidate.name, size: candidate.previewOffer!.size, price: candidate.price, shippingAmount: candidate.previewOffer!.shippingAmount }));
  const now = new Date();

  return (
    <section className="gift-page section-shell">
      {product.previewOffer ? <PreviewMetric event={{ name: "gift_start", productId: product.id }} /> : null}
      <CheckoutProgress currentStep={2} />
      <header className="gift-header">
        <p className="eyebrow">MAKE IT PERSONAL</p>
        <h1>この花に、<br />あなたの想いを。</h1>
        <p>お届けする日と、花に添える言葉を教えてください。</p>
      </header>
      <div className="gift-layout">
        <aside className="order-summary">
          {sizeProducts.length ? <div className="summary-size-images">{sizeProducts.map((candidate) => <figure key={candidate.id}>
            <div className="summary-image"><Image src={candidate.imageUrl} alt={candidate.imageAlt} fill sizes="(max-width: 767px) 45vw, 22vw" /></div>
            <figcaption>{candidate.name}</figcaption>
          </figure>)}</div> : <div className="summary-image">
            <Image
              src={product.imageUrl}
              alt={product.imageAlt}
              fill
              priority
              sizes="(max-width: 760px) 112px, 36vw"
            />
          </div>}
          <div className="summary-copy">
            <div><p className="eyebrow">YOUR SELECTION</p><h2>{product.previewOffer ? "BLOOM BOX" : product.name}</h2></div>
            {!product.previewOffer ? <p>{formatMoney(product.price)}</p> : null}
          </div>
          {product.shippingAmount !== undefined && !product.previewOffer ? <p className="field-note">
            {giftExperienceContent.launch.shippingLabel} {formatMoney(money(product.shippingAmount))} · {giftExperienceContent.launch.totalLabel} {formatMoney(money(product.price.amount + product.shippingAmount))}
          </p> : null}
          <p className="summary-note">{product.previewOffer ? giftExperienceContent.launch.notice : "税込・送料別"}</p>
        </aside>
        {product.available ? <GiftForm
          sizeOptions={sizeOptions}
          productId={product.id}
          productName={product.name}
          unitPrice={product.price}
          shippingAmount={product.shippingAmount}
          minDeliveryDate={getEarliestDeliveryDate(now)}
          maxDeliveryDate={getLatestDeliveryDate(now)}
        /> : (
          <div className="checkout-empty" role="status">
            <h2>この花は現在ご注文いただけません</h2>
            <p>別の花をお選びください。保存済みのカートの内容はそのままです。</p>
            <Link className="primary-button" href="/flowers">季節の花を見る</Link>
            <Link className="text-link" href="/cart">カートへ戻る</Link>
          </div>
        )}
      </div>
    </section>
  );
}
