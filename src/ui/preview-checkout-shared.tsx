import Link from "next/link";

export function TestModeBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div className="test-mode-banner" role="note">
      <strong>TEST MODE</strong>
      <span>{children ?? "これは購入体験を確認するためのダミー決済です。実際の注文・請求・配送は発生しません。"}</span>
    </div>
  );
}

export function MissingCheckoutState({ message }: { message: string }) {
  return (
    <div className="checkout-empty">
      <p className="eyebrow">CHECKOUT SESSION REQUIRED</p>
      <h2>購入手続きを再開できません。</h2>
      <p>{message}</p>
      <Link className="primary-button" href="/cart">
        カートへ戻る <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

export function PreviewCheckoutUnavailable() {
  return (
    <div className="checkout-empty">
      <p className="eyebrow">TEST CHECKOUT DISABLED</p>
      <h2>ダミー決済は利用できません。</h2>
      <p>この環境では、カートから安全な Stripe Checkout へお進みください。</p>
      <Link className="primary-button" href="/cart">
        カートへ戻る <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
