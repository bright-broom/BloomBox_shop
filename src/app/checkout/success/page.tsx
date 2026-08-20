import Link from "next/link";

export default function CheckoutReturnPage() {
  return (
    <section className="confirmation-page section-shell">
      <div className="confirmation-mark" aria-hidden="true">✓</div>
      <p className="eyebrow">PAYMENT PROCESSING</p>
      <h1>お支払い状況を<br />確認しています。</h1>
      <p className="confirmation-lead">
        決済画面から戻りました。注文の確定は、安全に検証された決済通知を受け取った後に行います。
        ブラウザーを閉じても処理は継続されます。
      </p>
      <Link className="primary-button" href="/flowers">
        花を見る <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
