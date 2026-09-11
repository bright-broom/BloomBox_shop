"use client";

import { createPurchaseIntentAction } from "@/modules/checkout/presentation/actions";
import {
  readRecoverableCart,
  removeCart,
  storePreviewDraft,
  type BrowserCartItem,
} from "@/modules/checkout/presentation/browser-checkout-session";
import { isAvailableDeliveryDate } from "@/modules/fulfillment/public";
import { formatMoney, money, multiplyMoney } from "@/shared/domain/money";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useCheckoutSessionRevision } from "@/ui/use-checkout-session-revision";

export function CartPage({
  added,
  checkoutCancelled,
  previewMode,
}: {
  added: boolean;
  checkoutCancelled: boolean;
  previewMode: boolean;
}) {
  const router = useRouter();
  const revision = useCheckoutSessionRevision();
  const cart: BrowserCartItem | null | undefined = revision === null
    ? undefined
    : readRecoverableCart(window.sessionStorage);
  const [state, formAction, pending] = useActionState(createPurchaseIntentAction, {});

  useEffect(() => {
    if (state.checkout) window.location.assign(state.checkout.url);
    if (state.draft) {
      storePreviewDraft(window.sessionStorage, {
        version: 1,
        displayId: state.draft.displayId,
        productName: state.draft.productName,
        quantity: state.draft.quantity,
        deliveryDate: state.draft.deliveryDate,
        subtotalAmount: state.draft.subtotalAmount,
      });
      router.push("/checkout/test");
    }
  }, [router, state.checkout, state.draft]);

  function clearCart() {
    removeCart(window.sessionStorage);
  }

  if (cart === undefined) {
    return <p className="checkout-loading" role="status">カートを確認しています…</p>;
  }

  if (!cart) {
    return (
      <div className="checkout-empty">
        <p className="eyebrow">YOUR CART IS EMPTY</p>
        <h2>カートは空です。</h2>
        <p>贈りたい花を選び、お届け日とメッセージを設定してください。</p>
        <Link className="primary-button" href="/flowers">
          花を選ぶ <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  const deliveryDateAvailable = isAvailableDeliveryDate(cart.deliveryDate);
  const unitPrice = money(cart.unitAmount);
  const subtotal = multiplyMoney(unitPrice, cart.quantity);

  return (
    <div className="cart-layout">
      <div className="cart-main">
        {!deliveryDateAvailable ? (
          <div className="checkout-notice" role="alert">
            <p>お届け希望日を選び直してください。お名前とメッセージは保存されています。</p>
            <Link className="text-link" href={`/gift/${encodeURIComponent(cart.productId)}`}>お届け希望日を変更する</Link>
          </div>
        ) : null}
        {added ? <p className="checkout-notice" role="status">ギフトをカートに保存しました。</p> : null}
        {checkoutCancelled ? (
          <p className="checkout-notice" role="status">
            Stripe の決済は行われていません。カートの内容を保持しているため、もう一度お進みいただけます。
          </p>
        ) : null}
        {previewMode ? (
          <div className="test-mode-banner" role="note">
            <strong>TEST MODE</strong>
            <span>この環境ではダミー決済を再現します。実際の注文・請求・配送は発生しません。</span>
          </div>
        ) : null}
        <article className="cart-item">
          <div className="cart-item-heading">
            <div>
              <p className="eyebrow">GIFT IN YOUR CART</p>
              <h2>{cart.productName}</h2>
            </div>
            <p>{formatMoney(unitPrice)} × {cart.quantity} 点</p>
          </div>
          <dl className="checkout-details">
            <div><dt>お届けする方</dt><dd>{cart.recipientName}</dd></div>
            <div><dt>お届け希望日</dt><dd>{cart.deliveryDate}</dd></div>
            <div><dt>贈ることば</dt><dd className="preserve-lines">{cart.giftMessage}</dd></div>
          </dl>
          <div className="cart-item-actions">
            <Link className="text-link" href={`/gift/${encodeURIComponent(cart.productId)}`}>内容を変更する</Link>
            <button className="text-button" type="button" onClick={clearCart}>カートから削除</button>
          </div>
        </article>
      </div>
      <aside className="checkout-totals">
        <p className="eyebrow">ORDER SUMMARY</p>
        <h2>ご注文内容</h2>
        <dl>
          <div><dt>商品小計</dt><dd>{formatMoney(subtotal)}</dd></div>
          <div><dt>送料</dt><dd>決済前に表示</dd></div>
          <div className="checkout-total-row"><dt>お支払い合計</dt><dd>決済前に確定</dd></div>
        </dl>
        <form action={formAction}>
          <input type="hidden" name="requestId" value={cart.requestId} />
          <input type="hidden" name="productId" value={cart.productId} />
          <input type="hidden" name="quantity" value={cart.quantity} />
          <input type="hidden" name="recipientName" value={cart.recipientName} />
          <input type="hidden" name="deliveryDate" value={cart.deliveryDate} />
          <input type="hidden" name="giftMessage" value={cart.giftMessage} />
          {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
          {state.fieldErrors ? (
            <p className="form-error" role="alert">
              入力内容の有効期限が切れています。ギフト設定を更新してください。
            </p>
          ) : null}
          <button className="primary-button form-submit" type="submit" disabled={pending || !deliveryDateAvailable}>
            {pending ? "安全に準備しています…" : "購入手続きへ"}
            <span aria-hidden="true">→</span>
          </button>
        </form>
        <p className="checkout-policy-copy">
          1 回のご注文につき、お届け先は 1 か所です。購入手続きの中で送料と最終合計をご確認いただけます。
        </p>
        <nav className="checkout-policy-links" aria-label="購入条件">
          <Link href="/commercial-transactions">特定商取引法に基づく表記</Link>
          <Link href="/shipping-returns">配送・返品</Link>
          <Link href="/terms">利用規約</Link>
        </nav>
      </aside>
    </div>
  );
}
