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
      <div className={`content-sections content-sections-${page.kind}`}>
        {page.sections.map((section, index) => page.kind === "faq" ? (
          <details key={section.title} className="faq-item" open={index === 0}>
            <summary>{section.title}</summary>
            <div>{section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
          </details>
        ) : (
          <section key={section.title}>
            <h2>{section.title}</h2>
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
