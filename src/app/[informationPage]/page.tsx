import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  findStorefrontPage,
  storefrontContent,
} from "@/shared/infrastructure/content/storefront-content";
import { siteContent } from "@/shared/infrastructure/content/site-content";

export const dynamicParams = false;

type InformationPageProps = { params: Promise<{ informationPage: string }> };

export function generateStaticParams() {
  return storefrontContent.pages.map((page) => ({ informationPage: page.slug }));
}

export async function generateMetadata({ params }: InformationPageProps): Promise<Metadata> {
  const page = findStorefrontPage((await params).informationPage);
  return page ? {
    title: page.title,
    description: page.lead,
    alternates: { canonical: `/${page.slug}` },
  } : {};
}

/** Pages with this many sections open with a table of contents; shorter pages read in one glance. */
const CONTENTS_MINIMUM_SECTIONS = 4;
const sectionNumber = (index: number) => String(index + 1).padStart(2, "0");
// Sections referenced from elsewhere carry an editorial ID; the rest are addressable by position.
const sectionAnchor = (id: string | undefined, index: number) => id ?? `section-${index + 1}`;

export default async function InformationPage({ params }: InformationPageProps) {
  const page = findStorefrontPage((await params).informationPage);
  if (!page) notFound();

  return (
    <article className="content-page section-shell">
      <nav className="breadcrumbs" aria-label="パンくずリスト">
        <Link href="/">ホーム</Link><span aria-hidden="true">/</span><span>{page.title}</span>
      </nav>
      <header className="content-header">
        <p className="eyebrow">{page.eyebrow}</p>
        <h1>{page.title}</h1>
        <p>{page.lead}</p>
      </header>
      {page.notice ? <p className="content-notice" role="note">{page.notice}</p> : null}
      {page.kind !== "faq" && page.sections.length >= CONTENTS_MINIMUM_SECTIONS ? (
        <nav className="content-toc" aria-label="このページの内容">
          <p className="eyebrow">CONTENTS</p>
          <ol>{page.sections.map((section, index) => <li key={section.title}>
            <a href={`#${sectionAnchor(section.id, index)}`}><span aria-hidden="true">{sectionNumber(index)}</span>{section.title}</a>
          </li>)}</ol>
        </nav>
      ) : null}
      <div className={`content-sections content-sections-${page.kind}`}>
        {page.sections.map((section, index) => page.kind === "faq" ? (
          <details key={section.title} id={section.id} className="faq-item" open={index === 0}>
            <summary>{section.title}</summary>
            <div>{section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
          </details>
        ) : (
          <section key={section.title} id={sectionAnchor(section.id, index)} className="reveal">
            <h2>{page.sections.length > 1 ? <span className="content-section-index" aria-hidden="true">{sectionNumber(index)}</span> : null}{section.title}</h2>
            {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items ? (
              <dl className="disclosure-list">
                {section.items.map((item) => (
                  <div key={item.term}><dt>{item.term}</dt><dd>{item.description}</dd></div>
                ))}
              </dl>
            ) : null}
          </section>
        ))}
      </div>
      {page.slug === "contact" ? (
        <div className="content-contact">
          <p>メールでのお問い合わせ</p>
          <a className="primary-button" href={`mailto:${siteContent.contactEmail}`}>
            {siteContent.contactEmail}<span aria-hidden="true">↗</span>
          </a>
        </div>
      ) : null}
    </article>
  );
}
