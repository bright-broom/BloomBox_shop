import type { Metadata } from "next";
import Link from "next/link";

// A distinct title tells assistive technology and browser history that this is not the requested page.
export const metadata: Metadata = { title: "ページが見つかりません" };

export default function NotFound() {
  return (
    <section className="state-page section-shell">
      <p className="eyebrow">404 — NOT FOUND</p>
      <h1>お探しの花は、<br />ここにはないようです。</h1>
      <Link className="primary-button" href="/flowers">季節の花を見る →</Link>
    </section>
  );
}
