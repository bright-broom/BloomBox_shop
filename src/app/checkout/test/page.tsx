import type { Metadata } from "next";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { CheckoutProgress } from "@/ui/checkout-progress";
import { PreviewBuyerForm } from "@/ui/preview-buyer-form";

export const metadata: Metadata = {
  title: "お届け先入力（Test Mode）",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PreviewCheckoutBuyerRoute() {
  return (
    <section className="checkout-page section-shell" data-checkout-page="test-buyer">
      <CheckoutProgress currentStep={4} />
      <header className="checkout-header">
        <p className="eyebrow">DELIVERY DETAILS</p>
        <h1>お届け先情報</h1>
        <p>テスト購入に必要な、ご注文者と配送先の情報を入力してください。</p>
      </header>
      <PreviewBuyerForm enabled={loadRuntimeMode() === "preview"} />
    </section>
  );
}
