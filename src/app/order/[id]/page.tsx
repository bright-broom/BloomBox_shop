import { application } from "@/shared/infrastructure/composition-root";
import { formatMoney } from "@/shared/domain/money";
import Link from "next/link";
import { notFound } from "next/navigation";

type OrderPageProps = { params: Promise<{ id: string }> };

export default async function OrderPage({ params }: OrderPageProps) {
  const { id } = await params;
  const order = await application.getOrder.execute(id);
  if (!order) notFound();

  return (
    <section className="confirmation-page section-shell">
      <div className="confirmation-mark" aria-hidden="true">✓</div>
      <p className="eyebrow">GIFT DRAFT CREATED</p>
      <h1>贈る準備が<br />できました。</h1>
      <p className="confirmation-lead">
        入力内容を確認しました。デモ版のため決済は行われていません。
      </p>
      <dl className="confirmation-details">
        <div><dt>注文番号</dt><dd>{order.displayId}</dd></div>
        <div><dt>お花</dt><dd>{order.item.productName}</dd></div>
        <div><dt>お届け先</dt><dd>{order.recipient.name} さま</dd></div>
        <div><dt>お届け予定</dt><dd>{order.recipient.deliveryDate}</dd></div>
        <div><dt>合計</dt><dd>{formatMoney(order.item.subtotal)}</dd></div>
        <div><dt>状態</dt><dd>お支払い待ち</dd></div>
      </dl>
      <Link className="primary-button" href="/flowers">別の花を見る <span aria-hidden="true">→</span></Link>
    </section>
  );
}
