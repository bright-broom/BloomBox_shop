import { productId } from "@/modules/catalog/domain/product";
import { getEarliestDeliveryDate } from "@/modules/fulfillment/domain/delivery-date";
import { application } from "@/shared/infrastructure/composition-root";
import { formatMoney } from "@/shared/domain/money";
import { GiftForm } from "@/ui/gift-form";
import Image from "next/image";
import { notFound } from "next/navigation";

type GiftPageProps = { params: Promise<{ productId: string }> };

export default async function GiftPage({ params }: GiftPageProps) {
  const { productId: rawProductId } = await params;
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
          <p className="summary-note">税込・送料別 ｜ 数量 1</p>
        </aside>
        <GiftForm productId={product.id} minDeliveryDate={getEarliestDeliveryDate()} />
      </div>
    </section>
  );
}
