"use client";

import {
  acceptPreviewReview,
  readCart,
  readPreviewBuyer,
  readPreviewDraft,
  type BrowserCartItem,
  type PreviewBuyer,
  type PreviewDraft,
} from "@/modules/checkout/presentation/browser-checkout-session";
import { formatMoney, money } from "@/shared/domain/money";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent } from "react";
import {
  MissingCheckoutState,
  PreviewCheckoutUnavailable,
  TestModeBanner,
} from "@/ui/preview-checkout-shared";
import { useCheckoutSessionRevision } from "@/ui/use-checkout-session-revision";

export function PreviewOrderReview({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const revision = useCheckoutSessionRevision();
  const cart: BrowserCartItem | null | undefined = revision === null ? undefined : readCart(window.sessionStorage);
  const buyer: PreviewBuyer | null | undefined = revision === null ? undefined : readPreviewBuyer(window.sessionStorage);
  const draft: PreviewDraft | null | undefined = revision === null
    ? undefined
    : readPreviewDraft(window.sessionStorage);

  if (!enabled) return <PreviewCheckoutUnavailable />;
  if (cart === undefined || buyer === undefined || draft === undefined) {
    return <p className="checkout-loading" role="status">注文内容を確認しています…</p>;
  }
  if (!cart || !buyer || !draft) {
    return <MissingCheckoutState message="配送先情報から購入手続きを再開してください。" />;
  }

  const subtotal = money(draft.subtotalAmount);
  const total = money(subtotal.amount + draft.shippingAmount);

  function continueToPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    acceptPreviewReview(window.sessionStorage);
    router.push("/checkout/test/payment");
  }

  return (
    <div className="review-layout">
      <div className="review-main">
        <TestModeBanner />
        <section className="review-section">
          <div className="review-section-heading">
            <div><p className="eyebrow">GIFT</p><h2>ギフト内容</h2></div>
            <Link className="text-link" href={`/gift/${encodeURIComponent(cart.productId)}`}>変更</Link>
          </div>
          <dl className="checkout-details">
            <div><dt>お花</dt><dd>{draft.productName} × {draft.quantity} 点</dd></div>
            <div><dt>お届けする方</dt><dd>{cart.recipientName}</dd></div>
            <div><dt>お届け希望日</dt><dd>{cart.deliveryDate}</dd></div>
            <div><dt>贈ることば</dt><dd className="preserve-lines">{cart.giftMessage}</dd></div>
          </dl>
        </section>
        <section className="review-section">
          <div className="review-section-heading">
            <div><p className="eyebrow">DELIVERY</p><h2>ご注文者・配送先</h2></div>
            <Link className="text-link" href="/checkout/test">変更</Link>
          </div>
          <dl className="checkout-details">
            <div><dt>ご注文者</dt><dd>{buyer.buyerName}</dd></div>
            <div><dt>連絡先</dt><dd>{buyer.email}<br />{buyer.phone}</dd></div>
            <div>
              <dt>配送先</dt>
              <dd>
                〒{buyer.postalCode}<br />
                {buyer.prefecture}{buyer.city}{buyer.addressLine1}<br />
                {buyer.addressLine2}
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <aside className="checkout-totals">
        <p className="eyebrow">FINAL TOTAL</p>
        <h2>お支払い内容</h2>
        <dl>
          <div><dt>商品小計</dt><dd>{formatMoney(subtotal)}</dd></div>
          <div><dt>テスト送料</dt><dd>{formatMoney(money(draft.shippingAmount))}</dd></div>
          <div className="checkout-total-row"><dt>お支払い合計</dt><dd>{formatMoney(total)}</dd></div>
        </dl>
        <form onSubmit={continueToPayment}>
          <label className="consent-field">
            <input type="checkbox" required />
            <span>
              <Link href="/terms">利用規約</Link>、<Link href="/privacy">プライバシーポリシー</Link>、
              <Link href="/shipping-returns">配送・返品条件</Link>を確認しました。
            </span>
          </label>
          <button className="primary-button form-submit" type="submit">
            テスト決済へ <span aria-hidden="true">→</span>
          </button>
        </form>
        <p className="checkout-policy-copy">
          ボタンを押しても、まだテスト注文は確定しません。次の画面で決済結果を再現します。
        </p>
      </aside>
    </div>
  );
}
