"use client";

import {
  completePreviewCheckout,
  PREVIEW_PAYMENT_LAST_FOUR,
  PREVIEW_SHIPPING_AMOUNT,
  readCart,
  readPreviewBuyer,
  readPreviewDraft,
  readPreviewReview,
  type BrowserCartItem,
  type PreviewDraft,
} from "@/modules/checkout/presentation/browser-checkout-session";
import { formatMoney, money } from "@/shared/domain/money";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MissingCheckoutState,
  PreviewCheckoutUnavailable,
  TestModeBanner,
} from "@/ui/preview-checkout-shared";
import { useCheckoutSessionRevision } from "@/ui/use-checkout-session-revision";

export function PreviewPayment({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const revision = useCheckoutSessionRevision();
  const cart: BrowserCartItem | null | undefined = revision === null ? undefined : readCart(window.sessionStorage);
  const draft: PreviewDraft | null | undefined = revision === null
    ? undefined
    : readPreviewDraft(window.sessionStorage);
  const ready = revision === null ? undefined : Boolean(
    readPreviewBuyer(window.sessionStorage)
    && draft
    && readPreviewReview(window.sessionStorage)
  );
  const [paymentError, setPaymentError] = useState<string>();
  const [pending, setPending] = useState(false);

  if (!enabled) return <PreviewCheckoutUnavailable />;
  if (cart === undefined || draft === undefined || ready === undefined) {
    return <p className="checkout-loading" role="status">決済情報を確認しています…</p>;
  }
  if (!cart || !draft || !ready) {
    return <MissingCheckoutState message="注文内容を確認し、規約への同意後にテスト決済へ進んでください。" />;
  }

  const totalAmount = draft.subtotalAmount + PREVIEW_SHIPPING_AMOUNT;

  function completePayment() {
    setPending(true);
    setPaymentError(undefined);
    const receipt = completePreviewCheckout(window.sessionStorage);
    if (!receipt) {
      setPaymentError("テスト決済を完了できませんでした。注文内容をもう一度ご確認ください。");
      setPending(false);
      return;
    }
    router.replace("/checkout/test/complete");
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
        {paymentError ? <p className="form-error" role="alert">{paymentError}</p> : null}
      </div>
      <aside className="checkout-totals">
        <p className="eyebrow">PAYMENT SUMMARY</p>
        <h2>テスト注文</h2>
        <dl>
          <div><dt>{draft.productName} × {draft.quantity} 点</dt><dd>{formatMoney(money(draft.subtotalAmount))}</dd></div>
          <div><dt>テスト送料</dt><dd>{formatMoney(money(PREVIEW_SHIPPING_AMOUNT))}</dd></div>
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
