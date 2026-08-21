import type { Metadata } from "next";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { PreviewCheckoutComplete } from "@/ui/preview-checkout-complete";

export const metadata: Metadata = {
  title: "テスト注文完了",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PreviewCheckoutCompleteRoute() {
  return (
    <section className="confirmation-page section-shell" data-checkout-page="test-complete">
      <PreviewCheckoutComplete enabled={loadRuntimeMode() === "preview"} />
    </section>
  );
}
