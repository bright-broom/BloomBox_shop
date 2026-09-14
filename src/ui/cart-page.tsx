"use client";

import { quoteLoyalty } from "@/modules/customer/public";
import type { CustomerLoyaltyState } from "@/shared/infrastructure/customer-loyalty";
import { customerAccountContent } from "@/shared/infrastructure/content/customer-account-content";
import { cancelPurchaseIntentAction, createPurchaseIntentAction } from "@/modules/checkout/presentation/actions";
import {
  readRecoverableCart,
  removeCart,
  storeCart,
  storePreparedPreviewDraft,
  CartChangedError,
  type BrowserCartItem,
} from "@/modules/checkout/presentation/browser-checkout-session";
import { isAvailableDeliveryDate } from "@/modules/fulfillment/public";
import { formatMoney, money, multiplyMoney } from "@/shared/domain/money";
import Link from "next/link";
import { CheckoutStorageUnavailable } from "@/ui/checkout-storage-unavailable";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { CHECKOUT_SESSION_UNAVAILABLE, useCheckoutSessionRevision } from "@/ui/use-checkout-session-revision";
import { FlowerLoading } from "@/ui/flower-loading";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { recordPreviewMetric } from "@/shared/infrastructure/preview-metrics";
import { SHIPPING_QUOTE_MAX_QUANTITY } from "@/modules/checkout/public";

export function CartPage({
  added,
  checkoutCancelled,
  previewMode,
  catalogPrices,
  loyalty = null,
  previousOrderKept = false,
}: {
  loyalty?: CustomerLoyaltyState | null;
  added: boolean;
  checkoutCancelled: boolean;
  /** The replaced cart belonged to a checkout that was already completed and was not cancelled. */
  previousOrderKept?: boolean;
  previewMode: boolean;
  catalogPrices: readonly { productId: string; unitAmount: number; shippingAmount: number }[];
}) {
  const router = useRouter();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const revision = useCheckoutSessionRevision();
  const cart: BrowserCartItem | null | undefined = (revision === null || revision === CHECKOUT_SESSION_UNAVAILABLE)
    ? undefined
    : readRecoverableCart(window.sessionStorage);
  const [state, formAction, pending] = useActionState(async (previous: Parameters<typeof createPurchaseIntentAction>[0], formData: FormData) => {
    try {
      const result = await createPurchaseIntentAction(previous, formData);
      if (result.checkout) window.location.assign(result.checkout.url);
      if (result.draft) {
        storePreparedPreviewDraft(window.sessionStorage, result.draft.requestId, { version: 1, ...result.draft });
        recordPreviewMetric({ name: "begin_checkout", requestId: result.draft.requestId });
        router.push("/checkout/test");
      }
      const submittedRequestId = formData.get("requestId");
      if ((result.restart || result.completed) && typeof submittedRequestId === "string") {
        if (result.restart) {
          // The prepared purchase ended without payment. Keep the gift, but let the next attempt start a new purchase.
          const current = readRecoverableCart(window.sessionStorage);
          if (current) storeCart(window.sessionStorage, { ...current, requestId: crypto.randomUUID() }, submittedRequestId);
        } else {
          // Checkout already finished for this cart. Clear it so that it cannot start a duplicate order.
          setRemovalNotice(giftExperienceContent.cart.orderAlreadyCompleted);
          removeCart(window.sessionStorage, submittedRequestId);
        }
      }
      return result;
    } catch (error) {
      setRemovalNotice(null);
      return { error: error instanceof CartChangedError ? error.message : "購入手続きを進められませんでした。入力内容はカートに残っています。同じ操作を再試行してください。" };
    }
  }, {});

  async function clearCart() {
    if (pending || removing || !cart) return;
    setRemoveError(null);
    setRemovalNotice(null);
    const requestId = cart.requestId;
    let notice: string | null = null;
    if (!previewMode) {
      // A prepared purchase may hold a box. Keep the cart until the server confirms cancellation.
      setRemoving(true);
      try {
        const result = await cancelPurchaseIntentAction(requestId);
        if ("error" in result) {
          setRemoveError(result.error);
          return;
        }
        // Production does not clear the cart after payment. Never let clearing it read as an order cancellation.
        if (result.status === "completed") notice = giftExperienceContent.cart.completedNotice;
      } catch {
        setRemoveError(giftExperienceContent.cart.cancelFailed);
        return;
      } finally {
        setRemoving(false);
      }
    }
    try {
      setRemovalNotice(notice);
      removeCart(window.sessionStorage, requestId);
    } catch (error) {
      setRemovalNotice(null);
      setRemoveError(error instanceof CartChangedError ? error.message : giftExperienceContent.cart.removeError);
    }
  }

  if (revision === CHECKOUT_SESSION_UNAVAILABLE) return <CheckoutStorageUnavailable />;
  if (cart === undefined) {
    return <p className="checkout-loading" role="status">カートを確認しています…</p>;
  }

  if (!cart) {
    return (
      <div className="checkout-empty">
        {removalNotice ? <p className="checkout-notice" role="status">{removalNotice}</p> : null}
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
  const catalogPrice = catalogPrices.find((price) => price.productId === cart.productId);
  const unitPrice = money(catalogPrice?.unitAmount ?? cart.unitAmount);
  const subtotal = multiplyMoney(unitPrice, cart.quantity);
  const shippingUnavailable = (cart.productId.startsWith("native_") && !catalogPrice)
    || (catalogPrice !== undefined && cart.quantity !== SHIPPING_QUOTE_MAX_QUANTITY);

  const loyaltyApplies = !previewMode && cart.productId.startsWith("native_");
  const loyaltyUnavailable = loyaltyApplies && loyalty?.status === "unavailable";
  const discount = loyaltyApplies && loyalty?.status === "ready" && !shippingUnavailable
    ? quoteLoyalty(loyalty.progress.eligibleSpendYen, subtotal.amount).discountYen : 0;

  return (
    <div className="cart-layout">
      <div className="cart-main">
        {shippingUnavailable ? <p className="checkout-notice" role="alert">{giftExperienceContent.cart.shippingUnavailable}</p> : null}
        {!deliveryDateAvailable ? (
          <div className="checkout-notice" role="alert">
            <p>お届け希望日を選び直してください。お名前とメッセージは保存されています。</p>
            <Link className="text-link" href={`/gift/${encodeURIComponent(cart.productId)}`}>お届け希望日を変更する</Link>
          </div>
        ) : null}
        {added ? <p className="checkout-notice" role="status">ギフトをカートに保存しました。</p> : null}
        {previousOrderKept ? <p className="checkout-notice" role="status">{giftExperienceContent.cart.previousOrderKeptNotice}</p> : null}
        {checkoutCancelled ? (
          <p className="checkout-notice" role="status">
            Stripe の決済は行われていません。カートの内容を保持しているため、もう一度お進みいただけます。
            {giftExperienceContent.cart.checkoutCancelledHint}
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
            <button className="text-button" type="button" onClick={() => { void clearCart(); }} disabled={pending || removing}>
              {removing ? giftExperienceContent.cart.cancelPending : "カートから削除"}
            </button>
          </div>
          {removing ? <p className="form-hint" role="status">{giftExperienceContent.cart.cancelPending}</p> : null}
          {removeError ? <p className="form-error" role="alert">{removeError}</p> : null}
        </article>
      </div>
      <aside className="checkout-totals">
        <p className="eyebrow">ORDER SUMMARY</p>
        <h2>ご注文内容</h2>
        <dl>
          <div><dt>商品小計</dt><dd>{formatMoney(subtotal)}</dd></div>
          {discount > 0 ? <div><dt>{customerAccountContent.loyalty.cartDiscount}</dt><dd>−{formatMoney(money(discount))}</dd></div> : null}
          <div><dt>送料</dt><dd>{catalogPrice ? formatMoney(money(catalogPrice.shippingAmount)) : "決済前に表示"}</dd></div>
          <div className="checkout-total-row"><dt>お支払い合計</dt><dd>{catalogPrice ? formatMoney(money(subtotal.amount - discount + catalogPrice.shippingAmount)) : "決済前に確定"}</dd></div>
        </dl>
        {loyaltyUnavailable ? <p role="alert" className="form-error">{customerAccountContent.loyalty.cartUnavailable}</p> : null}
        {discount > 0 ? <p className="form-hint">{customerAccountContent.loyalty.cartEstimate}</p> : null}
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
          <button className="primary-button form-submit" type="submit" disabled={pending || removing || !deliveryDateAvailable || shippingUnavailable || loyaltyUnavailable}>
            {pending ? "安全に準備しています…" : "購入手続きへ"}
            <span aria-hidden="true">→</span>
          </button>
          {pending ? <FlowerLoading compact title={giftExperienceContent.loading.cart} /> : null}
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
