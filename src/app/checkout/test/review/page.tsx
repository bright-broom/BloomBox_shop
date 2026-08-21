import type { Metadata } from "next";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { CheckoutProgress } from "@/ui/checkout-progress";
import { PreviewOrderReview } from "@/ui/preview-order-review";

export const metadata: Metadata = {
  title: "注文内容の確認（Test Mode）",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PreviewOrderReviewRoute() {
  return (
    <section className="checkout-page section-shell" data-checkout-page="test-review">
      <CheckoutProgress currentStep={4} />
      <header className="checkout-header">
        <p className="eyebrow">REVIEW YOUR ORDER</p>
        <h1>注文内容の確認</h1>
        <p>商品、配送先、送料、合計金額を確認してから、テスト決済へお進みください。</p>
      </header>
      <PreviewOrderReview enabled={loadRuntimeMode() === "preview"} />
    </section>
  );
}
