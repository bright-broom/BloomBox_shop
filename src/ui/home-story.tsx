import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/modules/catalog/public";
import { homeContent } from "@/shared/infrastructure/content/home-content";
import { siteContent } from "@/shared/infrastructure/content/site-content";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { HomeIcon, type HomeIconName } from "./home-icon";

export function HomeShortcuts() {
  const copy = homeContent.visual;
  const links = [
    { icon: "flower", href: "#collection", label: copy.shortcuts.flowers },
    { icon: "pen", href: "#guide", label: copy.shortcuts.message },
    { icon: "calendar", href: "#delivery", label: copy.shortcuts.delivery },
  ] as const;
  return <nav data-analytics-section="shortcuts" className="home-shortcuts section-shell" aria-label={copy.shortcuts.label}>
    {links.map((item, index) => <Link key={item.href} href={item.href}>
      <span className="home-shortcut-number" aria-hidden="true">0{index + 1}</span>
      <HomeIcon name={item.icon} /><span>{item.label}</span><HomeIcon name="down" size={18} />
    </Link>)}
  </nav>;
}

/**
 * The brand's package concept with a message card carrying the gift form's real default message. The caption
 * states that both are images; the recipe restates the diagram in words for assistive technology.
 */
export function HomeGiftDiagram() {
  const copy = homeContent.visual.diagram;
  return <figure className="home-gift-visual">
    <div className="home-gift-stage">
      <div className="home-gift-photo">
        <Image src={copy.image.src} alt={copy.image.alt} fill sizes="(max-width: 767px) 100vw, 45vw" />
      </div>
      <div className="home-gift-card" aria-hidden="true">
        <span className="eyebrow">{copy.cardEyebrow}</span>
        <span className="home-gift-card-message">{giftExperienceContent.giftForm.defaultMessage}</span>
        <HomeIcon name="flower" size={20} />
      </div>
    </div>
    <p className="home-gift-recipe">
      <span><HomeIcon name="flower" size={18} />{copy.flower}</span>
      <HomeIcon name="plus" size={16} />
      <span><HomeIcon name="mail" size={18} />{copy.message}</span>
      <span className="home-gift-recipe-result">
        <HomeIcon name="arrow" size={16} />
        <strong><HomeIcon name="gift" size={18} />{copy.result}</strong>
      </span>
    </p>
    <figcaption>{copy.caption}</figcaption>
  </figure>;
}

const occasionIcons: Record<string, HomeIconName> = { "ありがとう": "thanks", "誕生日": "cake", "記念日": "heart" };

export function HomeOccasions({ products }: { products: readonly Product[] }) {
  const copy = homeContent.visual.occasions;
  const items = copy.items.filter((item) => products.some((product) => product.available && product.occasion.includes(item.label)));
  if (!items.length) return null;
  return <section data-analytics-section="occasions" className="home-occasions section-shell home-reveal" aria-labelledby="home-occasions-title">
    <div className="home-occasion-heading"><p className="eyebrow">{copy.eyebrow}</p><h2 id="home-occasions-title">{copy.title}</h2></div>
    <div className="home-occasion-grid">{items.map((item) => <Link className="home-occasion" key={item.label} href={`/flowers?occasion=${encodeURIComponent(item.label)}`}>
      <span className="home-icon-tile"><HomeIcon name={occasionIcons[item.label] ?? "flower"} size={32} /></span>
      <span><strong>{item.label}</strong><small>{item.note}</small></span>
      <HomeIcon name="external" size={20} />
    </Link>)}</div>
  </section>;
}

export function HomeJourney() {
  const copy = siteContent.home.guide;
  const icons = ["flower", "pen", "gift"] as const;
  const accents = ["leaf", "heart", "sparkle"] as const;
  return <section data-analytics-section="journey" id="guide" className="how-it-works home-journey section-shell" aria-labelledby="guide-title">
    <div className="journey-heading home-reveal"><div><p className="eyebrow">{copy.eyebrow}</p><h2 id="guide-title">{copy.title}</h2></div><p>{copy.description}</p></div>
    <ol className="home-journey-steps home-reveal">{copy.steps.map((step, index) => <li key={step.title}>
      <div className="home-step-art" aria-hidden="true"><span className="home-step-number">0{index + 1}</span>
        <HomeIcon className="home-step-main" name={icons[index]} size={72} />
        <span className="home-step-accent"><HomeIcon name={accents[index]} size={26} /></span>
      </div><h3>{step.title}</h3><p>{step.description}</p>
      {index < copy.steps.length - 1 ? <span className="home-step-next" aria-hidden="true"><HomeIcon name="arrow" /></span> : null}
    </li>)}</ol>
    <Link className="secondary-button" href="/guide">{copy.action}<HomeIcon name="arrow" /></Link>
  </section>;
}
