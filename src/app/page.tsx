import { SizeComparison } from "@/ui/size-comparison";
import { ProductCard } from "@/ui/product-card";
import { application } from "@/shared/infrastructure/composition-root";
import { siteContent } from "@/shared/infrastructure/content/site-content";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { HomeAnnouncements, HomeAssurance, HomeDelivery, HomeFaq, HomeGallery, HomeMembership, HomeReviews } from "@/ui/home-sections";
import { homeContent } from "@/shared/infrastructure/content/home-content";
import { loadRuntimeMode } from "@/shared/infrastructure/config/runtime-config";
import { HomeGiftDiagram, HomeJourney, HomeOccasions, HomeShortcuts } from "@/ui/home-story";
import { HomeIcon } from "@/ui/home-icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function HomePage() {
  const products = await application.listProducts.execute();
  const { hero, home } = siteContent;
  const now = new Date();

  return (
    <>
      <HomeAnnouncements now={now} />
      <section data-analytics-section="hero" className="hero" aria-labelledby="hero-title">
        <Image src={hero.imageUrl} alt={hero.imageAlt} fill priority sizes="100vw" className="hero-image" />
        <div className="hero-copy">
          <p className="eyebrow home-hero-kicker"><HomeIcon name="flower" size={20} />{hero.eyebrow}</p>
          <p className="display-title" aria-hidden="true">{hero.displayTitle}</p>
          <h1 id="hero-title">{hero.title}{hero.emphasis}</h1>
        </div>
        <div className="hero-actions">
          <Link className="secondary-button" href="/about">{hero.secondaryAction}<HomeIcon name="external" size={20} /></Link>
          <Link className="primary-button" href="/flowers">{hero.primaryAction}<HomeIcon name="arrow" size={20} /></Link>
        </div>
      </section>
      <HomeShortcuts />

      <section data-analytics-section="intro" className="intro-section home-intro section-shell" aria-labelledby="intro-title">
        <div className="intro-layout home-intro-layout home-reveal">
          <div className="intro-copy">
            <p className="eyebrow">{home.intro.eyebrow}</p>
            <h2 id="intro-title">{home.intro.title.map((line) => <span key={line}>{line}</span>)}</h2>
            <p>{hero.lead.map((line) => <span key={line}>{line}</span>)}</p>
            <p>{home.intro.description}</p>
            <Link className="text-link" href="/about">{home.intro.action}<HomeIcon name="external" size={20} /></Link>
          </div>
          <HomeGiftDiagram />
        </div>
      </section>
      <HomeOccasions products={products} />

      <section data-analytics-section="collection" id="collection" className="collection section-shell home-reveal" aria-labelledby="collection-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{home.collection.eyebrow}</p>
            <h2 id="collection-title">{home.collection.title}</h2>
            <p className="section-description">{home.collection.description}</p>
          </div>
          <Link className="secondary-button" href="/flowers">{home.collection.action}<HomeIcon name="external" size={20} /></Link>
        </div>
        <HomeGallery products={products} />
        {products.some((product) => product.previewOffer) ? <SizeComparison products={products} guidance={homeContent.comparison} /> : <div className="product-grid">
          {products.length > 0 ? products.map((product) => (
            <ProductCard key={product.id} product={product} />
          )) : <p className="catalog-empty" role="status">{siteContent.catalog.emptyMessage}</p>}
        </div>}
      </section>

      <HomeDelivery now={now} preview={loadRuntimeMode() === "preview"} />
      <HomeAssurance />
      <HomeJourney />
      <HomeReviews />
      <HomeFaq />
      <HomeMembership />
    </>
  );
}
