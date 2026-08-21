import type { Metadata } from "next";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { CheckoutProgress } from "@/ui/checkout-progress";
import { PreviewPayment } from "@/ui/preview-payment";

export const metadata: Metadata = {
  title: "ダミー決済（Test Mode）",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PreviewPaymentRoute() {
  return (
    <section className="checkout-page section-shell" data-checkout-page="test-payment">
      <CheckoutProgress currentStep={5} />
      <header className="checkout-header">
        <p className="eyebrow">DUMMY PAYMENT</p>
        <h1>テスト決済</h1>
        <p>実カード情報を入力せず、成功と失敗の両方を安全に再現できます。</p>
      </header>
      <PreviewPayment enabled={loadRuntimeMode() === "preview"} />
    </section>
  );
}
