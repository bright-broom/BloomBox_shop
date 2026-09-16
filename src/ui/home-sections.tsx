import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/modules/catalog/public";
import { getEarliestDeliveryDate, getLatestDeliveryDate } from "@/modules/fulfillment/public";
import { activeHomeAnnouncements, homeContent, homeSection, type HomeContent } from "@/shared/infrastructure/content/home-content";
import { storefrontContent } from "@/shared/infrastructure/content/storefront-content";
import { HomeIcon } from "./home-icon";

export function HomeAnnouncements({ now, content = homeContent }: { now: Date; content?: HomeContent }) {
  const items = activeHomeAnnouncements(content, now);
  if (!items.length) return null;
  return <aside className="home-announcements section-shell" aria-labelledby="home-news-title">
    <h2 id="home-news-title"><HomeIcon name="info" />{content.announcementsTitle}</h2>
    <ul>{items.map((item) => <li key={item.id} className={item.severity === "important" ? "is-important" : undefined}>
      <h3>{item.href ? <Link href={item.href}>{item.title}<HomeIcon name="arrow" /></Link> : item.title}</h3>
      <p>{item.body}</p>
    </li>)}</ul>
  </aside>;
}

export function HomeGallery({ products, content = homeContent }: { products: readonly Product[]; content?: HomeContent }) {
  const items = content.gallery.items.filter((item) => item.status === "approved"
    && products.some((product) => product.slug === item.productSlug));
  if (!items.length) return null;
  return <section className="home-gallery" aria-labelledby="home-gallery-title">
    <p className="eyebrow">{content.gallery.eyebrow}</p>
    <h2 id="home-gallery-title">{content.gallery.title}</h2>
    <div className="home-media-grid">{items.map((item) => <figure key={item.id}>
      <Link href={`/flowers/${item.productSlug}`}>
        <Image src={item.src} alt={item.alt} width={720} height={720} sizes="(max-width: 767px) 100vw, 33vw" />
      </Link>
      <figcaption>{item.caption}</figcaption>
    </figure>)}</div>
  </section>;
}

function CalendarDate({ value }: { value: string }) {
  const [year, month, day] = value.split("-");
  return <time dateTime={value}>{year}/{month}/{day}</time>;
}

export function HomeDelivery({ now, preview }: { now: Date; preview: boolean }) {
  const copy = homeContent.delivery;
  return <section id="delivery" className="home-delivery section-shell" aria-labelledby="home-delivery-title">
    <div className="home-panel">
      <div><p className="eyebrow">{copy.eyebrow}</p><h2 id="home-delivery-title">{copy.title}</h2>
        <ol className="home-delivery-route" aria-label={homeContent.visual.deliverySteps.label}>
          {homeContent.visual.deliverySteps.items.map((label, index) => <li key={label}><span className="home-route-node"><HomeIcon name={(["box", "truck", "heart"] as const)[index]} size={28} /></span><span>{label}</span></li>)}
        </ol>
        <Link className="text-link" href="/shipping-returns">{copy.action}<HomeIcon name="arrow" /></Link>
      </div>
      <div className="home-delivery-window"><HomeIcon name="truck" />
        <p>{preview ? copy.previewLabel : copy.rangeLabel}</p>
        <p className="home-date-range"><CalendarDate value={getEarliestDeliveryDate(now)} /><span aria-hidden="true">—</span><CalendarDate value={getLatestDeliveryDate(now)} /></p>
        <p className="field-note">{copy.note}</p>
      </div>
    </div>
  </section>;
}

export function HomeAssurance() {
  const copy = homeContent.assurance;
  return <section className="home-section section-shell" aria-labelledby="home-care-title">
    <p className="eyebrow">{copy.eyebrow}</p><h2 id="home-care-title">{copy.title}</h2>
    {storefrontContent.publicationStatus === "draft" ? <p className="field-note">{copy.draftNote}</p> : null}
    <div className="home-care-grid">{copy.items.map((item) => <details className="home-care-item" key={item.section}>
      <summary><HomeIcon name={item.icon} /><span>{item.title}</span><HomeIcon name="chevron" /></summary>
      <div>{homeSection(item.page, item.section).body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        <Link className="text-link" href={`/${item.page}#${item.section}`} aria-label={`${item.title}：${copy.action}`}>{copy.action}<HomeIcon name="arrow" /></Link>
      </div>
    </details>)}</div>
  </section>;
}

export function HomeFaq() {
  const copy = homeContent.faq;
  return <section className="home-section home-faq section-shell" aria-labelledby="home-faq-title">
    <div><span className="home-faq-mark"><HomeIcon name="help" size={44} /></span><p className="eyebrow">{copy.eyebrow}</p><h2 id="home-faq-title">{copy.title}</h2>
      <p className="field-note">{homeContent.visual.faqNote}</p>
      <Link className="text-link" href="/faq">{copy.action}<HomeIcon name="arrow" /></Link>
    </div>
    <div>{copy.sectionIds.map((id) => {
      const section = homeSection("faq", id);
      return <details className="faq-item" key={id}><summary>{section.title}</summary>
        <div>{section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
      </details>;
    })}<Link className="text-link" href="/contact">{copy.contact}<HomeIcon name="help" /></Link></div>
  </section>;
}

export function HomeMembership() {
  const copy = homeContent.membership;
  return <section className="home-membership section-shell" aria-labelledby="home-membership-title">
    <div className="home-panel"><div><p className="eyebrow">{copy.eyebrow}</p>
      <h2 id="home-membership-title">{copy.title}</h2><p>{copy.description}</p>
      <nav className="home-account-links" aria-label={homeContent.visual.accountLinks.label}>
        <Link href="/account" prefetch={false}><HomeIcon name="box" /><span>{homeContent.visual.accountLinks.orders}</span></Link>
        <Link href="/account/favorites" prefetch={false}><HomeIcon name="heart" /><span>{homeContent.visual.accountLinks.favorites}</span></Link>
        <Link href="/account/addresses" prefetch={false}><HomeIcon name="pin" /><span>{homeContent.visual.accountLinks.addresses}</span></Link>
      </nav>
      <Link className="primary-button" href="/account" prefetch={false}>{copy.action}<HomeIcon name="arrow" /></Link>
    </div><div className="home-membership-note"><HomeIcon name="sprout" />
      <h3>{copy.benefitTitle}</h3><p>{copy.benefitNote}</p>
    </div></div>
  </section>;
}

export function HomeReviews({ content = homeContent }: { content?: HomeContent }) {
  const items = content.reviews.items.filter((item) => item.status === "approved"
    && item.verifiedPurchase && item.publicationConsent);
  if (!items.length) return null;
  return <section className="home-section section-shell" aria-labelledby="home-reviews-title">
    <p className="eyebrow">{content.reviews.eyebrow}</p><h2 id="home-reviews-title">{content.reviews.title}</h2>
    <div className="home-media-grid">{items.map((item) => <figure className="home-review" key={item.id}>
      {item.photo ? <Image src={item.photo.src} alt={item.photo.alt} width={720} height={720} sizes="(max-width: 767px) 100vw, 33vw" /> : null}
      {item.photo ? <p className="field-note">{item.photo.caption}</p> : null}
      <blockquote><p>{item.quote}</p></blockquote><figcaption>{item.displayName}</figcaption>
    </figure>)}</div>
  </section>;
}
