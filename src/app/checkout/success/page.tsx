import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney } from "@/shared/domain/money";
import { application } from "@/shared/infrastructure/composition-root";
import {
  InvalidOrderTrackingReferenceError,
  type OrderProgress,
} from "@/modules/order/public";
import { OrderStatusRefresh } from "@/ui/order-status-refresh";
import { CompletedCheckoutCartCleanup } from "@/ui/completed-checkout-cart-cleanup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "ご注文状況",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type CheckoutReturnPageProps = {
  searchParams: Promise<{ session_id?: string | string[] }>;
};

const progressCopy: Record<OrderProgress, Readonly<{ eyebrow: string; title: string; body: string }>> = {
  PROCESSING: {
    eyebrow: "PAYMENT PROCESSING",
    title: "お支払い状況を確認しています。",
    body: "決済通知を安全に検証しています。ブラウザーを閉じても処理は継続されます。",
  },
  PAYMENT_FAILED: {
    eyebrow: "PAYMENT NOT COMPLETED",
    title: "お支払いを完了できませんでした。",
    body: "請求は確定していません。お支払い方法をご確認の上、もう一度ご注文ください。",
  },
  CHECKOUT_EXPIRED: {
    eyebrow: "CHECKOUT EXPIRED",
    title: "決済画面の有効期限が切れました。",
    body: "請求は発生していません。最新の商品情報を確認して、もう一度ご注文ください。",
  },
  CONFIRMED: {
    eyebrow: "ORDER CONFIRMED",
    title: "ご注文を承りました。",
    body: "お支払いを確認しました。お届けの準備が進み次第、販売事業者からご案内します。",
  },
  FULFILLING: {
    eyebrow: "PREPARING YOUR GIFT",
    title: "お届けの準備を進めています。",
    body: "花の状態を確認しながら、ギフトを丁寧に準備しています。",
  },
  SHIPPED: {
    eyebrow: "GIFT SHIPPED",
    title: "ギフトを発送しました。",
    body: "配送状況は、下記のお問い合わせ番号からご確認いただけます。",
  },
  DELIVERED: {
    eyebrow: "GIFT DELIVERED",
    title: "お届けが完了しました。",
    body: "BloomBox をお選びいただき、ありがとうございました。",
  },
  CANCELLED: {
    eyebrow: "ORDER CANCELLED",
    title: "ご注文はキャンセルされました。",
    body: "ご不明な点がある場合は、受付番号を添えてお問い合わせください。",
  },
  REFUNDED: {
    eyebrow: "PAYMENT REFUNDED",
    title: "返金手続きを完了しました。",
    body: "カード会社への反映時期は、ご利用の決済手段によって異なります。",
  },
  PARTIALLY_REFUNDED: {
    eyebrow: "PAYMENT PARTIALLY REFUNDED",
    title: "一部返金を受け付けました。",
    body: "返金額とカード会社への反映時期は、販売事業者からの案内をご確認ください。",
  },
  ATTENTION: {
    eyebrow: "SUPPORT NEEDED",
    title: "ご注文状況をご確認ください。",
    body: "個別の確認が必要です。受付番号を添えてお問い合わせください。",
  },
};

export default async function CheckoutReturnPage({ searchParams }: CheckoutReturnPageProps) {
  const rawReference = (await searchParams).session_id;
  const reference = Array.isArray(rawReference) ? rawReference[0] : rawReference;
  const lookup = reference ? await getOrderStatus(reference) : { valid: false, order: null };
  if (!lookup.valid) return <MissingCheckoutReference />;
  const order = lookup.order;
  const progress = order?.progress ?? "PROCESSING";
  const copy = progressCopy[progress];

  return (
    <section className="confirmation-page section-shell">
      <div className="confirmation-mark" aria-hidden="true">
        {[
          "ATTENTION", "CANCELLED", "PAYMENT_FAILED", "CHECKOUT_EXPIRED",
        ].includes(progress) ? "!" : "✓"}
      </div>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p className="confirmation-lead">{copy.body}</p>
      {order ? (
        <dl className="confirmation-details">
          <div><dt>受付番号</dt><dd>{order.displayId}</dd></div>
          <div><dt>お花</dt><dd>{order.productName} × {order.quantity}</dd></div>
          <div><dt>お届け予定</dt><dd>{order.deliveryDate}</dd></div>
          {order.total ? <div><dt>お支払い合計</dt><dd>{formatMoney(order.total)}</dd></div> : null}
          {order.trackingReference ? (
            <div>
              <dt>配送番号</dt>
              <dd>{order.carrierCode ? `${order.carrierCode} ` : ""}{order.trackingReference}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {reference && progress === "PROCESSING" ? <OrderStatusRefresh reference={reference} /> : null}
      {/* Production keeps the browser cart after payment; once the order exists, clear the cart that started it. */}
      {order?.orderCreated ? <CompletedCheckoutCartCleanup purchaseIntentId={order.purchaseIntentId} /> : null}
      <div className="confirmation-actions">
        {order && ["PAYMENT_FAILED", "CHECKOUT_EXPIRED"].includes(progress) ? (
          <Link className="primary-button" href={`/gift/${encodeURIComponent(order.productId)}`}>
            もう一度注文する <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <Link className="primary-button" href="/flowers">
            花を見る <span aria-hidden="true">→</span>
          </Link>
        )}
        <Link className="text-link" href="/contact">注文について問い合わせる</Link>
      </div>
    </section>
  );
}

async function getOrderStatus(reference: string) {
  try {
    return { valid: true, order: await application.getOrderStatus.execute(reference) } as const;
  } catch (error) {
    if (error instanceof InvalidOrderTrackingReferenceError) {
      return { valid: false, order: null } as const;
    }
    throw error;
  }
}

function MissingCheckoutReference() {
  return (
    <section className="confirmation-page section-shell">
      <div className="confirmation-mark" aria-hidden="true">!</div>
      <p className="eyebrow">ORDER REFERENCE REQUIRED</p>
      <h1>注文状況を表示できません。</h1>
      <p className="confirmation-lead">
        決済完了後に表示されたページ、または販売事業者から届いた案内をご確認ください。
      </p>
      <div className="confirmation-actions">
        <Link className="primary-button" href="/flowers">
          花を見る <span aria-hidden="true">→</span>
        </Link>
        <Link className="text-link" href="/contact">お問い合わせ</Link>
      </div>
    </section>
  );
}
