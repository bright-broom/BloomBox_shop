import Link from "next/link";
import type { ReactNode } from "react";
import { siteContent } from "@/shared/infrastructure/content/site-content";
import { customerAccountContent } from "@/shared/infrastructure/content/customer-account-content";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { findStorefrontPage } from "@/shared/infrastructure/content/storefront-content";
import type { RuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import type { CheckoutProviderMode } from "@/shared/infrastructure/config/checkout-provider-config";
import { PreviewFooterLinks } from "@/ui/preview-footer-links";

type GroupKey = keyof typeof siteContent.footer.groups;

function supportHours(): string | null {
  const desk = findStorefrontPage("contact")?.sections.find((section) => section.id === "support-desk");
  return desk?.items?.find((item) => item.term === "受付時間")?.description ?? null;
}

function FooterGroup({ id, children }: { id: GroupKey; children: ReactNode }) {
  const group = siteContent.footer.groups[id];
  return <nav className="footer-group" aria-labelledby={`footer-${id}`}>
    <h2 className="footer-heading" id={`footer-${id}`}>
      <span aria-hidden="true">{group.label}</span>{group.title}
    </h2>
    <ul className="footer-links">{children}</ul>
  </nav>;
}

/** The closing section of every page: a next step, grouped links, support hours and the legal notices. */
export function SiteFooter({ runtime, checkout }: { runtime: RuntimeMode; checkout: CheckoutProviderMode }) {
  const copy = siteContent.footer;
  const hours = supportHours();
  return <footer className="site-footer">
    <div className="footer-inner">
      <div className="footer-lead">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <p className="footer-statement">{copy.tagline}</p>
        </div>
        <div className="footer-actions">
          <Link className="primary-button" href="/flowers">{copy.action}<span aria-hidden="true">↗</span></Link>
          <Link className="secondary-button" href="/contact">{copy.contact}</Link>
        </div>
      </div>
      <div className="footer-columns">
        <FooterGroup id="shop">
          <li><Link href="/flowers">季節の花</Link></li>
          <li><Link href="/gift-next">{giftExperienceContent.recipient.label}</Link></li>
          <PreviewFooterLinks runtime={runtime} checkout={checkout} />
        </FooterGroup>
        <FooterGroup id="support">
          <li><Link href="/guide">ご利用ガイド</Link></li>
          <li><Link href="/shipping-returns">配送・返品</Link></li>
          <li><Link href="/faq">よくあるご質問</Link></li>
          <li><Link href="/contact">お問い合わせ</Link></li>
        </FooterGroup>
        <FooterGroup id="account">
          <li><Link href="/account" prefetch={false}>{customerAccountContent.title}</Link></li>
          <li><Link href="/account/register" prefetch={false}>{customerAccountContent.registration.registerLink}</Link></li>
          <li><Link href="/operations" prefetch={false}>{customerAccountContent.entry.operator}</Link></li>
        </FooterGroup>
        <FooterGroup id="about">
          <li><Link href="/about">私たちについて</Link></li>
          <li><Link href="/privacy">プライバシー</Link></li>
          <li><Link href="/terms">利用規約</Link></li>
          <li><Link href="/commercial-transactions">特定商取引法に基づく表記</Link></li>
        </FooterGroup>
      </div>
      <div className="footer-brand-row">
        <Link className="brand footer-brand" href="/" aria-label={`${siteContent.brandName} ホーム`}>
          <span>{siteContent.brandName}</span>
        </Link>
        {hours ? <p className="footer-hours"><span>{copy.hoursLabel}</span>{hours}</p> : null}
      </div>
      <div className="footer-bottom">
        <span>{copy.originNote}</span>
        <span>© {new Date().getFullYear()} {copy.copyrightHolder}</span>
        <a className="footer-top-link" href="#main-content">{copy.backToTop}<span aria-hidden="true">↑</span></a>
      </div>
    </div>
  </footer>;
}
