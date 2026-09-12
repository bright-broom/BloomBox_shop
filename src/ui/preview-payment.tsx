"use client";

import {
  completePreviewCheckout,
  PREVIEW_PAYMENT_LAST_FOUR,
  readCart,
  readPreviewBuyer,
  readPreviewDraft,
  readPreviewReview,
  type BrowserCartItem,
  type PreviewDraft,
} from "@/modules/checkout/presentation/browser-checkout-session";
import { formatMoney, money } from "@/shared/domain/money";
import Link from "next/link";
import { CheckoutStorageUnavailable } from "@/ui/checkout-storage-unavailable";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlowerLoading } from "@/ui/flower-loading";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import {
  MissingCheckoutState,
  PreviewCheckoutUnavailable,
  TestModeBanner,
} from "@/ui/preview-checkout-shared";
import { CHECKOUT_SESSION_UNAVAILABLE, useCheckoutSessionRevision } from "@/ui/use-checkout-session-revision";
import { quotePreviewReferralAction, settlePreviewReferralAction, type PreviewReferralQuote } from "@/modules/checkout/presentation/preview-referral-actions";
import { referralContent as referralCopy, referralCopy as formatReferralCopy } from "@/shared/infrastructure/content/referral-content";

export function PreviewPayment({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const revision = useCheckoutSessionRevision();
  const cart: BrowserCartItem | null | undefined = (revision === null || revision === CHECKOUT_SESSION_UNAVAILABLE) ? undefined : readCart(window.sessionStorage);
  const draft: PreviewDraft | null | undefined = (revision === null || revision === CHECKOUT_SESSION_UNAVAILABLE)
    ? undefined
    : readPreviewDraft(window.sessionStorage);
  const ready = (revision === null || revision === CHECKOUT_SESSION_UNAVAILABLE) ? undefined : Boolean(
    readPreviewBuyer(window.sessionStorage)
    && draft
    && readPreviewReview(window.sessionStorage)
  );
  const [paymentError, setPaymentError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [quote, setQuote] = useState<PreviewReferralQuote>();
  const [referralNotice, setReferralNotice] = useState<string>();
  const [skipReferral, setSkipReferral] = useState(false);

  if (!enabled) return <PreviewCheckoutUnavailable />;
  if (revision === CHECKOUT_SESSION_UNAVAILABLE) return <CheckoutStorageUnavailable />;
  if (completed) return <p className="checkout-loading" role="status">完了画面を表示しています…</p>;
  if (cart === undefined || draft === undefined || ready === undefined) {
    return <p className="checkout-loading" role="status">決済情報を確認しています…</p>;
  }
  if (!cart || !draft || !ready) {
    return <MissingCheckoutState message="注文内容を確認し、規約への同意後にテスト決済へ進んでください。" />;
  }

  const discountAmount = quote?.requestId === cart.requestId && quote.subtotalAmount === draft.subtotalAmount && !skipReferral ? quote.discountAmount : 0;
  const totalAmount = draft.subtotalAmount + draft.shippingAmount - discountAmount;

  async function applyReferral() {
    if (!cart || !draft) return;
    setPending(true); setPaymentError(undefined); setReferralNotice(undefined);
    try {
      const result = await quotePreviewReferralAction({ requestId: cart.requestId, productId: cart.productId, quantity: cart.quantity });
      if (result.error) { setPaymentError(result.error); return; }
      if (result.quote?.subtotalAmount !== draft.subtotalAmount || result.quote?.shippingAmount !== draft.shippingAmount) {
        setPaymentError("商品価格が変わりました。カートからもう一度お進みください。"); return;
      }
      setQuote(result.quote); setSkipReferral(false);
      setReferralNotice(result.quote.discountAmount ? formatReferralCopy(referralCopy.quoteApplied) : referralCopy.quoteNone);
    } catch { setPaymentError(referralCopy.loadError); }
    finally { setPending(false); }
  }

  async function completePayment() {
    if (!cart || !draft) return;
    setPending(true);
    setPaymentError(undefined);
    try {
      const result = await settlePreviewReferralAction({
        requestId: cart.requestId, productId: cart.productId, quantity: cart.quantity,
        expectedSubtotal: draft.subtotalAmount, expectedShipping: draft.shippingAmount, couponId: discountAmount ? quote?.couponId : null,
      });
      if (!result.quote && !(skipReferral && result.unavailable)) {
        setPaymentError(result.error ?? referralCopy.loadError); return;
      }
      const settlement = result.quote;
      setCompleted(true);
      const receipt = completePreviewCheckout(window.sessionStorage, new Date(), settlement);
      if (!receipt) {
        setCompleted(false);
        setPaymentError("テスト決済を完了できませんでした。注文内容をもう一度ご確認ください。"); return;
      }
      router.replace("/checkout/test/complete");
    } catch { setCompleted(false); setPaymentError("完了情報を保存できませんでした。同じ操作を再試行してください。"); }
    finally {
      setPending(false);
    }
  }

  function reproduceFailure() {
    setPaymentError("テスト用の決済失敗を再現しました。請求は発生していません。成功シナリオでもう一度お試しいただけます。");
  }

  return (
    <div className="payment-layout">
      <div className="payment-panel">
        <TestModeBanner>
          Stripe やカード会社の API は呼び出しません。固定のダミーカードだけを表示しています。
        </TestModeBanner>
        <section className="dummy-card" aria-label="テスト用ダミーカード">
          <span>DUMMY CARD</span>
          <strong>•••• •••• •••• {PREVIEW_PAYMENT_LAST_FOUR}</strong>
          <div><span>BLOOMBOX TEST</span><span>12 / 34</span></div>
        </section>
        <div className="payment-safety-note">
          <h2>実際のカード番号は入力しないでください</h2>
          <p>この画面にはカード入力欄がありません。テストシナリオの選択だけで購入完了画面まで確認できます。</p>
        </div>
        <section className="referral-payment">
          <h2>{referralCopy.overviewTitle}</h2>
          <p>{formatReferralCopy(referralCopy.terms)}</p>
          <button className="secondary-button" disabled={pending} onClick={applyReferral}>{referralCopy.quoteAction}</button>
          {referralNotice ? <p role="status">{referralNotice}</p> : null}
          <Link className="text-link" href="/referrals">{referralCopy.showReferrals}</Link>
          <label className="consent-field"><input type="checkbox" checked={skipReferral} disabled={pending} onChange={(event) => { setSkipReferral(event.target.checked); setQuote(undefined); setReferralNotice(undefined); }} /><span>{referralCopy.quoteSkip}</span></label>
        </section>
        {paymentError ? <p className="form-error" role="alert">{paymentError}</p> : null}
        {pending ? <FlowerLoading compact title={giftExperienceContent.loading.payment} tipIndex={1} /> : null}
      </div>
      <aside className="checkout-totals">
        <p className="eyebrow">PAYMENT SUMMARY</p>
        <h2>テスト注文</h2>
        <dl>
          <div><dt>{draft.productName} × {draft.quantity} 点</dt><dd>{formatMoney(money(draft.subtotalAmount))}</dd></div>
          <div><dt>テスト送料</dt><dd>{formatMoney(money(draft.shippingAmount))}</dd></div>
          {discountAmount > 0 ? <div><dt>{referralCopy.discountLabel}</dt><dd>−{formatMoney(money(discountAmount))}</dd></div> : null}
          <div className="checkout-total-row"><dt>お支払い合計</dt><dd>{formatMoney(money(totalAmount))}</dd></div>
        </dl>
        <button className="primary-button form-submit" type="button" disabled={pending} onClick={completePayment}>
          {pending ? "完了処理中…" : "成功シナリオで完了"}
          <span aria-hidden="true">→</span>
        </button>
        <button className="secondary-button checkout-secondary-action" type="button" disabled={pending} onClick={reproduceFailure}>
          決済失敗を再現する
        </button>
        <Link className="text-link checkout-back-link" href="/checkout/test/review">注文確認へ戻る</Link>
      </aside>
    </div>
  );
}
