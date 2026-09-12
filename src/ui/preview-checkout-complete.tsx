"use client";

import { cleanupPreviewCheckout, readPreviewCheckoutCleanupStatus, readPreviewReceipt, type PreviewReceipt } from "@/modules/checkout/presentation/browser-checkout-session";
import { useState } from "react";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { formatMoney, money } from "@/shared/domain/money";
import Link from "next/link";
import { CheckoutStorageUnavailable } from "@/ui/checkout-storage-unavailable";
import { CHECKOUT_SESSION_UNAVAILABLE, useCheckoutSessionRevision } from "@/ui/use-checkout-session-revision";
import { PreviewCheckoutUnavailable, TestModeBanner } from "@/ui/preview-checkout-shared";
import { PreviewReferralOrder } from "@/ui/preview-referral-order";
import { referralContent } from "@/shared/infrastructure/content/referral-content";

export function PreviewCheckoutComplete({ enabled }: { enabled: boolean }) {
  const [cleanupError, setCleanupError] = useState(false);
  const revision = useCheckoutSessionRevision();
  const receipt: PreviewReceipt | null | undefined = (revision === null || revision === CHECKOUT_SESSION_UNAVAILABLE)
    ? undefined
    : readPreviewReceipt(window.sessionStorage);

  if (!enabled) return <PreviewCheckoutUnavailable />;
  if (revision === CHECKOUT_SESSION_UNAVAILABLE) return <CheckoutStorageUnavailable />;
  if (receipt === undefined) {
    return <p className="checkout-loading" role="status">テスト注文を確認しています…</p>;
  }
  if (!receipt) {
    return (
      <div className="checkout-empty">
        <p className="eyebrow">TEST RECEIPT REQUIRED</p>
        <h2>完了したテスト注文がありません。</h2>
        <p>カートからテスト購入を開始すると、注文完了までの一連の流れを確認できます。</p>
        <Link className="primary-button" href="/flowers">
          花を選ぶ <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  const cleanupStatus = readPreviewCheckoutCleanupStatus(window.sessionStorage, receipt.requestId);
  const cleanupCopy = giftExperienceContent.checkoutCleanup;
  function retryCleanup() {
    setCleanupError(false);
    if (!receipt?.requestId) return;
    try {
      cleanupPreviewCheckout(window.sessionStorage, receipt.requestId);
    } catch {
      setCleanupError(true);
    }
  }

  return (
    <>
      <div className="confirmation-mark" aria-hidden="true">✓</div>
      <p className="eyebrow">TEST ORDER COMPLETED</p>
      <h1>テスト注文が<br />完了しました。</h1>
      <p className="confirmation-lead">
        購入完了までの動作確認が完了しました。実際の注文・請求・配送は発生していません。
      </p>
      <div className="confirmation-banner"><TestModeBanner /></div>
      <dl className="confirmation-details">
        <div><dt>テスト受付番号</dt><dd>{receipt.displayId}</dd></div>
        <div><dt>お花</dt><dd>{receipt.productName} × {receipt.quantity} 点</dd></div>
        <div><dt>お届け希望日</dt><dd>{receipt.deliveryDate}</dd></div>
        <div><dt>商品小計</dt><dd>{formatMoney(money(receipt.subtotalAmount))}</dd></div>
        <div><dt>テスト送料</dt><dd>{formatMoney(money(receipt.shippingAmount))}</dd></div>
        {receipt.discountAmount > 0 ? <div><dt>{referralContent.discountLabel}</dt><dd>−{formatMoney(money(receipt.discountAmount))}</dd></div> : null}
        <div><dt>テスト合計</dt><dd>{formatMoney(money(receipt.totalAmount))}</dd></div>
      </dl>
      {cleanupStatus === "pending" ? (
        <div className="checkout-notice">
          <p role="alert">{cleanupCopy.pending}</p>
          <button className="secondary-button" type="button" onClick={retryCleanup}>{cleanupCopy.retry}</button>
          {cleanupError ? <p className="form-error" role="alert">{cleanupCopy.error}</p> : null}
        </div>
      ) : (
        <p className="data-minimization-note" role="status">{cleanupStatus === "complete" ? cleanupCopy.complete : cleanupCopy.changed}</p>
      )}
      <div className="confirmation-actions">
        <Link className="primary-button" href="/flowers">
          別の花を見る <span aria-hidden="true">→</span>
        </Link>
        <Link className="text-link" href="/cart">{cleanupCopy.cart}</Link>
      </div>
      <PreviewReferralOrder requestId={receipt.requestId} tracked={receipt.referralTracked} />
    </>
  );
}
