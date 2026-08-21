import { productId } from "@/modules/catalog/public";
import { getEarliestDeliveryDate, getLatestDeliveryDate } from "@/modules/fulfillment/public";
import { application } from "@/shared/infrastructure/composition-root";
import { formatMoney } from "@/shared/domain/money";
import { GiftForm } from "@/ui/gift-form";
import { CheckoutProgress } from "@/ui/checkout-progress";
import { randomUUID } from "node:crypto";
import Image from "next/image";
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

  return (
    <section className="gift-page section-shell">
      <CheckoutProgress currentStep={2} />
      <header className="gift-header">
        <p className="eyebrow">MAKE IT PERSONAL</p>
        <h1>この花に、<br />あなたの想いを。</h1>
        <p>お届けする日と、花に添える言葉を教えてください。</p>
      </header>
      <div className="gift-layout">
        <aside className="order-summary">
          <div className="summary-image">
            <Image
              src={product.imageUrl}
              alt={product.imageAlt}
              fill
              priority
              sizes="(max-width: 760px) 112px, 36vw"
            />
          </div>
          <div className="summary-copy">
            <div><p className="eyebrow">YOUR SELECTION</p><h2>{product.name}</h2></div>
            <p>{formatMoney(product.price)}</p>
          </div>
          <p className="summary-note">税込・送料別</p>
        </aside>
        <GiftForm
          productId={product.id}
          productName={product.name}
          unitPrice={product.price}
          minDeliveryDate={getEarliestDeliveryDate()}
          maxDeliveryDate={getLatestDeliveryDate()}
          requestId={randomUUID()}
        />
      </div>
    </section>
  );
}
