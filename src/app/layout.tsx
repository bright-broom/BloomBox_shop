import type { Metadata } from "next";
import { Noto_Sans_JP, Shippori_Mincho } from "next/font/google";
import Link from "next/link";
import { siteContent } from "@/shared/infrastructure/content/site-content";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { loadSiteUrlConfig } from "@/shared/infrastructure/config/site-url-config";
import { HeaderCartLink } from "@/ui/header-cart-link";
import "./globals.css";

const sans = Noto_Sans_JP({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const serif = Shippori_Mincho({
  variable: "--font-serif",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(loadSiteUrlConfig().origin),
  title: {
    default: siteContent.defaultTitle,
    template: siteContent.titleTemplate,
  },
  description: siteContent.description,
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: siteContent.brandName,
    title: siteContent.defaultTitle,
    description: siteContent.description,
    images: [{ url: siteContent.hero.imageUrl, alt: siteContent.hero.imageAlt }],
  },
  twitter: {
    card: "summary_large_image",
    title: siteContent.defaultTitle,
    description: siteContent.description,
    images: [siteContent.hero.imageUrl],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${sans.variable} ${serif.variable}`}>
        <a className="skip-link" href="#main-content">本文へ移動</a>
        <div className="service-bar" aria-label="BloomBox のサービス情報">
          {(loadRuntimeMode() === "preview"
            ? [siteContent.previewServiceMessage, ...siteContent.serviceMessages.slice(1)]
            : siteContent.serviceMessages
          ).map((message) => <span key={message}>{message}</span>)}
        </div>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="BloomBox ホーム">
            <span className="brand-mark" aria-hidden="true">
              B
            </span>
            <span>{siteContent.brandName}</span>
          </Link>
          <nav className="main-nav" aria-label="メインナビゲーション">
            <Link href="/flowers">季節の花</Link>
            <Link href="/about">私たちについて</Link>
            <Link href="/guide">ご利用ガイド</Link>
          </nav>
          <details className="mobile-menu">
            <summary>メニュー</summary>
            <nav aria-label="モバイルナビゲーション">
              <Link href="/flowers">季節の花</Link>
              <Link href="/about">私たちについて</Link>
              <Link href="/guide">ご利用ガイド</Link>
              <Link href="/faq">よくあるご質問</Link>
              <Link href="/cart">カート</Link>
            </nav>
          </details>
          <div className="header-actions">
            <HeaderCartLink />
            <Link className="header-cta" href="/flowers">
              ギフトをつくる
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </header>
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <div>
            <Link className="brand brand-light" href="/">
              <span className="brand-mark" aria-hidden="true">
                B
              </span>
              <span>{siteContent.brandName}</span>
            </Link>
            <p>{siteContent.footer.tagline}</p>
          </div>
          <div className="footer-meta">
            <div className="footer-nav-groups">
              <nav className="footer-nav" aria-label="商品・サービス">
                <Link href="/flowers">季節の花</Link>
                <Link href="/guide">ご利用ガイド</Link>
                <Link href="/shipping-returns">配送・返品</Link>
                <Link href="/faq">よくあるご質問</Link>
              </nav>
              <nav className="footer-nav" aria-label="BloomBoxについて">
                <Link href="/about">私たちについて</Link>
                <Link href="/contact">お問い合わせ</Link>
                <Link href="/privacy">プライバシー</Link>
                <Link href="/terms">利用規約</Link>
                <Link href="/commercial-transactions">特定商取引法に基づく表記</Link>
              </nav>
            </div>
            <div className="footer-note">
              <span>{siteContent.footer.originNote}</span>
              <span>© {new Date().getFullYear()} {siteContent.footer.copyrightHolder}</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
