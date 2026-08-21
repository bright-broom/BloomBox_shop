import type { Metadata } from "next";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { CartPage } from "@/ui/cart-page";
import { CheckoutProgress } from "@/ui/checkout-progress";

export const metadata: Metadata = {
  title: "カート",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type CartRouteProps = {
  searchParams: Promise<{ added?: string | string[]; checkout?: string | string[] }>;
};

export default async function CartRoute({ searchParams }: CartRouteProps) {
  const query = await searchParams;
  return (
    <section className="checkout-page section-shell" data-checkout-page="cart">
      <CheckoutProgress currentStep={3} />
      <header className="checkout-header">
        <p className="eyebrow">YOUR CART</p>
        <h1>カート</h1>
        <p>お届け内容を確認して、購入手続きへお進みください。</p>
      </header>
      <CartPage
        added={query.added === "1"}
        checkoutCancelled={query.checkout === "cancelled"}
        previewMode={loadRuntimeMode() === "preview"}
      />
    </section>
  );
}
