import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { homeContent, homeContentSchema } from "@/shared/infrastructure/content/home-content";
import { findStorefrontPage } from "@/shared/infrastructure/content/storefront-content";
import { getEarliestDeliveryDate, getLatestDeliveryDate } from "@/modules/fulfillment/public";
import { HomeAnnouncements, HomeAssurance, HomeDelivery, HomeFaq, HomeGallery, HomeMembership, HomeReviews } from "./home-sections";
import { HomeOccasions } from "./home-story";
import { PreviewFooterLinks } from "./preview-footer-links";
import { SizeComparison } from "./size-comparison";
import { productId, type Product } from "@/modules/catalog/public";
import { money } from "@/shared/domain/money";

// A synthetic registered photograph is isolated to this presentation test.
vi.mock("@/shared/infrastructure/config/native-catalog-image-config", async (original) => {
  const actual = await original<typeof import("@/shared/infrastructure/config/native-catalog-image-config")>();
  return { ...actual, productImageAssets: [...actual.productImageAssets, {
    src: "/images/products/sample.png", label: "Synthetic registered photograph", kind: "photograph",
  }] };
});

const product: Product = {
  id: productId("prod_bloombox_m"), externalReference: "sample", slug: "bloom-box-m", name: "BLOOM BOX M",
  subtitle: "検証用", description: "検証用", price: money(4000), shippingAmount: 1000,
  imageUrl: "/images/products/sample.png", imageAlt: "検証用", palette: "blue", occasion: [], flowers: [],
  grower: "検証用", available: true, previewOffer: { family: "bloombox", size: "M", shippingAmount: 1000 },
};

describe("home customer guidance", () => {
  it("offers only occasions with available products and encodes the existing catalog filter", () => {
    const html = renderToStaticMarkup(<HomeOccasions products={[{ ...product, occasion: ["誕生日"] }]} />);
    expect(html).toContain(`href="/flowers?occasion=${encodeURIComponent("誕生日")}"`);
    expect(html).not.toContain(encodeURIComponent("記念日"));
    expect(renderToStaticMarkup(<HomeOccasions products={[]} />)).toBe("");
    expect(renderToStaticMarkup(<HomeOccasions products={[{ ...product, available: false, occasion: ["誕生日"] }]} />)).toBe("");
  });

  it("renders no empty editorial sections or invented reviews", () => {
    expect(renderToStaticMarkup(<HomeAnnouncements now={new Date()} />)).toBe("");
    expect(renderToStaticMarkup(<HomeGallery products={[]} />)).toBe("");
    expect(renderToStaticMarkup(<HomeReviews />)).toBe("");
  });
  it("uses the same FAQ source and semantic disclosures with customer contact links", () => {
    const html = renderToStaticMarkup(<HomeFaq />);
    for (const id of homeContent.faq.sectionIds) {
      const section = findStorefrontPage("faq")!.sections.find((item) => item.id === id)!;
      expect(html).toContain(`<summary>${section.title}</summary>`);
      for (const body of section.body) expect(html).toContain(body);
    }
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/faq"');
  });
  it("keeps unapproved assurances identified as draft and offers conditions instead of guarantees", () => {
    const html = renderToStaticMarkup(<HomeAssurance />);
    expect(html).toContain(homeContent.assurance.draftNote);
    expect(html).toContain("正式な受付期限は本番公開前");
    expect(html).toContain('href="/contact#arrival-problem"');
  });
  it.each(["2026-09-17T14:59:59Z", "2026-09-17T15:00:00Z"])("shares the gift date window across the Japan midnight boundary: %s", (value) => {
    const now = new Date(value);
    const html = renderToStaticMarkup(<HomeDelivery now={now} preview />);
    expect(html).toContain(`dateTime="${getEarliestDeliveryDate(now)}"`);
    expect(html).toContain(`dateTime="${getLatestDeliveryDate(now)}"`);
    expect(html).toContain(homeContent.delivery.previewLabel);
    expect(html).toContain("到着を保証するものではありません");
    const commercial = renderToStaticMarkup(<HomeDelivery now={now} preview={false} />);
    expect(commercial).toContain(homeContent.delivery.rangeLabel);
    expect(commercial).not.toContain(homeContent.delivery.previewLabel);
  });
  it("offers the existing customer entry without claiming a live discount", () => {
    const html = renderToStaticMarkup(<HomeMembership />);
    expect(html).toContain('href="/account"');
    expect(html).toContain("ランク別の自動割引を準備しています");
    expect(html).not.toContain("/operations");
    expect(html).not.toMatch(/\d+%/);
  });
  it("escapes notice text and removes expired announcements", () => {
    const content = homeContentSchema.parse({ ...homeContent, announcements: [{ id: "sample", title: "<script>bad</script>", body: "検証用", severity: "important", startsAt: "2026-09-17T00:00:00Z", endsAt: "2026-09-18T00:00:00Z", href: "/guide" }] });
    const html = renderToStaticMarkup(<HomeAnnouncements now={new Date("2026-09-17T01:00:00Z")} content={content} />);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="/guide"');
    expect(renderToStaticMarkup(<HomeAnnouncements now={new Date("2026-09-18T00:00:00Z")} content={content} />)).toBe("");
  });
  it("excludes draft reviews and only renders approved permitted quotes", () => {
    const item = { id: "sample", status: "draft", quote: "掲載前の検証文章", displayName: "検証用", verifiedPurchase: true, publicationConsent: true };
    const draft = homeContentSchema.parse({ ...homeContent, reviews: { ...homeContent.reviews, items: [item] } });
    expect(renderToStaticMarkup(<HomeReviews content={draft} />)).toBe("");
    const approved = homeContentSchema.parse({ ...draft, reviews: { ...draft.reviews, items: [{ ...item, status: "approved" }] } });
    expect(renderToStaticMarkup(<HomeReviews content={approved} />)).toContain(item.quote);
  });
  it("only publishes photos for approved entries matching an available catalog product", () => {
    const entry = { id: "sample", productSlug: product.slug, status: "approved", src: product.imageUrl, alt: "検証用写真", caption: "実物確認済みの検証用キャプション" };
    const content = homeContentSchema.parse({ ...homeContent, gallery: { ...homeContent.gallery, items: [entry] } });
    expect(renderToStaticMarkup(<HomeGallery products={[]} content={content} />)).toBe("");
    expect(renderToStaticMarkup(<HomeGallery products={[product]} content={content} />)).toContain(entry.caption);
    const draft = homeContentSchema.parse({ ...content, gallery: { ...content.gallery, items: [{ ...entry, status: "draft" }] } });
    expect(renderToStaticMarkup(<HomeGallery products={[product]} content={draft} />)).toBe("");
  });
  it("hides unapproved size facts and preserves checkout totals and product routing", () => {
    const sizes = [{ size: "M" as const, status: "draft" as const, description: "未承認の仕様", facts: [{ label: "寸法", value: "検証用" }] }];
    const html = renderToStaticMarkup(<SizeComparison products={[product]} guidance={{ ...homeContent.comparison, sizes }} />);
    expect(html).not.toContain("未承認の仕様");
    expect(html).toContain("￥5,000");
    expect(html).toContain('href="/gift/prod_bloombox_m"');
    const approved = renderToStaticMarkup(<SizeComparison products={[product]} guidance={{ ...homeContent.comparison, sizes: [{ ...sizes[0], status: "approved", description: "承認済みの検証仕様" }] }} />);
    expect(approved).toContain("承認済みの検証仕様");
    expect(approved).not.toContain(homeContent.comparison.pending);
  });
});

describe("preview-only footer links", () => {
  it.each(["preview", "stripe"] as const)("never leaks test links in production with %s checkout", (checkout) => {
    expect(renderToStaticMarkup(<PreviewFooterLinks runtime="production" checkout={checkout} />)).toBe("");
  });
  it("keeps preview disclosure links but only links referrals with preview checkout", () => {
    const html = renderToStaticMarkup(<PreviewFooterLinks runtime="preview" checkout="preview" />);
    expect(html).toContain("/preview/gift-experience");
    expect(html).toContain("/referrals");
    expect(renderToStaticMarkup(<PreviewFooterLinks runtime="preview" checkout="stripe" />)).not.toContain("/referrals");
  });
});
