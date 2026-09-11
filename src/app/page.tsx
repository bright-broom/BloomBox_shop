import { ProductCard } from "@/ui/product-card";
import { application } from "@/shared/infrastructure/composition-root";
import { siteContent } from "@/shared/infrastructure/content/site-content";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function HomePage() {
  const products = await application.listProducts.execute();
  const { hero, home } = siteContent;

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <Image src={hero.imageUrl} alt={hero.imageAlt} fill priority sizes="100vw" className="hero-image" />
        <div className="hero-copy">
          <p className="eyebrow">{hero.eyebrow}</p>
          <p className="display-title" aria-hidden="true">{hero.displayTitle}</p>
          <h1 id="hero-title">{hero.title}{hero.emphasis}</h1>
        </div>
        <div className="hero-actions">
          <Link className="secondary-button" href="/about">{hero.secondaryAction}</Link>
          <Link className="primary-button" href="/flowers">{hero.primaryAction}</Link>
        </div>
      </section>

      <section className="intro-section section-shell" aria-labelledby="intro-title">
        <p className="eyebrow">{home.intro.eyebrow}</p>
        <div className="intro-layout">
          <h2 id="intro-title">{home.intro.title.map((line) => <span key={line}>{line}</span>)}</h2>
          <div className="intro-copy">
            <p>{hero.lead.map((line) => <span key={line}>{line}</span>)}</p>
            <p>{home.intro.description}</p>
            <Link className="text-link" href="/about">{home.intro.action}<span aria-hidden="true">↗</span></Link>
          </div>
        </div>
      </section>

      <section className="collection section-shell" aria-labelledby="collection-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{home.collection.eyebrow}</p>
            <h2 id="collection-title">{home.collection.title}</h2>
            <p className="section-description">{home.collection.description}</p>
          </div>
          <Link className="secondary-button" href="/flowers">{home.collection.action}<span aria-hidden="true">↗</span></Link>
        </div>
        <div className="product-grid">
          {products.length > 0 ? products.map((product) => (
            <ProductCard key={product.id} product={product} />
          )) : <p className="catalog-empty" role="status">{siteContent.catalog.emptyMessage}</p>}
        </div>
      </section>

      <section className="how-it-works section-shell" aria-labelledby="guide-title">
        <div className="dark-section-heading">
          <div>
            <p className="eyebrow">{home.guide.eyebrow}</p>
            <h2 id="guide-title">{home.guide.title}</h2>
          </div>
          <p>{home.guide.description}</p>
        </div>
        <ol className="steps">
          {home.guide.steps.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
        <Link className="secondary-button" href="/guide">{home.guide.action}<span aria-hidden="true">↗</span></Link>
      </section>
    </>
  );
}
