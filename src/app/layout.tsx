import type { Metadata } from "next";
import { Noto_Sans_JP, Shippori_Mincho } from "next/font/google";
import Link from "next/link";
import { siteContent } from "@/shared/infrastructure/content/site-content";
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
  title: {
    default: siteContent.defaultTitle,
    template: siteContent.titleTemplate,
  },
  description: siteContent.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${sans.variable} ${serif.variable}`}>
        <div className="service-bar" aria-label="BloomBoxのサービス情報">
          {siteContent.serviceMessages.map((message) => <span key={message}>{message}</span>)}
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
            <a href="#about">私たちについて</a>
          </nav>
          <Link className="header-cta" href="/flowers">
            ギフトをつくる
            <span aria-hidden="true">↗</span>
          </Link>
        </header>
        <main>{children}</main>
        <footer className="site-footer" id="about">
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
            <nav className="footer-nav" aria-label="フッターナビゲーション">
              <Link href="/flowers">季節の花</Link>
              <a href={`mailto:${siteContent.contactEmail}`}>お問い合わせ</a>
            </nav>
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
