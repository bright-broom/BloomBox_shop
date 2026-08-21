import { productId } from "@/modules/catalog/public";
import { getEarliestDeliveryDate, getLatestDeliveryDate } from "@/modules/fulfillment/public";
import { application } from "@/shared/infrastructure/composition-root";
import { formatMoney } from "@/shared/domain/money";
import { GiftForm } from "@/ui/gift-form";
import { randomUUID } from "node:crypto";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type GiftPageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ checkout?: string | string[] }>;
};

export default async function GiftPage({ params, searchParams }: GiftPageProps) {
  const { productId: rawProductId } = await params;
  const { checkout } = await searchParams;
  const product = await application.getProduct.byId(productId(rawProductId));
  if (!product) notFound();

  return (
    <section className="gift-page section-shell">
      <nav className="checkout-progress" aria-label="ギフト作成の進捗">
        <span className="is-complete"><b>1</b> 花を選ぶ</span>
        <span className="is-current" aria-current="step"><b>2</b> 想いを添える</span>
        <span><b>3</b> 内容確認</span>
      </nav>
      <header className="gift-header">
        <p className="eyebrow">MAKE IT PERSONAL</p>
        <h1>この花に、<br />あなたの想いを。</h1>
        <p>お届けする日と、花に添える言葉を教えてください。</p>
      </header>
      {checkout === "cancelled" ? (
        <p className="checkout-notice" role="status">
          決済は行われていません。入力内容を確認して、もう一度お進みください。
        </p>
      ) : null}
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
          unitPrice={product.price}
          minDeliveryDate={getEarliestDeliveryDate()}
          maxDeliveryDate={getLatestDeliveryDate()}
          requestId={randomUUID()}
        />
      </div>
    </section>
  );
}
