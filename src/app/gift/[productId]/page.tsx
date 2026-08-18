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
      <header className="gift-header">
        <p className="eyebrow">MAKE IT PERSONAL</p>
        <h1>この花に、<br />あなたの想いを。</h1>
        <p>お届けする日と、花に添える言葉を教えてください。</p>
      </header>
      <div className="gift-layout">
        <aside className="order-summary">
          <div className="summary-image">
            <Image src={product.imageUrl} alt={product.imageAlt} fill sizes="(max-width: 760px) 100vw, 36vw" />
          </div>
          <div className="summary-copy">
            <div><p className="eyebrow">YOUR SELECTION</p><h2>{product.name}</h2></div>
            <p>{formatMoney(product.price)}</p>
          </div>
        </aside>
        <GiftForm productId={product.id} minDeliveryDate={getEarliestDeliveryDate()} />
      </div>
    </section>
  );
}
