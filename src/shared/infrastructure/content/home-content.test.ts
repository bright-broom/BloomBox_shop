import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { activeHomeAnnouncements, homeContent, homeContentSchema, homeSection } from "./home-content";

const notice = { id: "delivery", title: "お届けのご案内", body: "詳細をご確認ください。", severity: "info" as const,
  startsAt: "2026-09-17T09:00:00+09:00", endsAt: "2026-09-18T09:00:00+09:00", href: "/shipping-returns" };

describe("home content publication", () => {
  it("uses start-inclusive and end-exclusive absolute times and prioritizes important notices", () => {
    const content = homeContentSchema.parse({ ...homeContent, announcements: [notice, { ...notice, id: "urgent", severity: "important" }] });
    expect(activeHomeAnnouncements(content, new Date("2026-09-16T23:59:59Z"))).toEqual([]);
    expect(activeHomeAnnouncements(content, new Date("2026-09-17T00:00:00Z")).map((item) => item.id)).toEqual(["urgent", "delivery"]);
    expect(activeHomeAnnouncements(content, new Date("2026-09-18T00:00:00Z"))).toEqual([]);
  });
  it.each(["javascript:alert(1)", "//external.example", "/%2f%2fexternal.example", "/\\external.example"])("rejects unsafe editorial links: %s", (href) => {
    expect(homeContentSchema.safeParse({ ...homeContent, announcements: [{ ...notice, href }] }).success).toBe(false);
  });
  it("rejects reversed windows, timezone-less dates and duplicate identifiers", () => {
    for (const announcements of [
      [{ ...notice, endsAt: notice.startsAt }],
      [{ ...notice, startsAt: "2026-09-17T09:00:00" }],
      [notice, notice],
    ]) expect(homeContentSchema.safeParse({ ...homeContent, announcements }).success).toBe(false);
  });
  it("requires real FAQ references so content changes cannot silently lose answers", () => {
    expect(homeContentSchema.safeParse({ ...homeContent, faq: { ...homeContent.faq, sectionIds: ["missing", "delivery-date", "message"] } }).success).toBe(false);
    expect(homeSection("faq", "delivery-date").title).toBe("お届け日は指定できますか？");
    expect(() => homeSection("faq", "missing")).toThrow("Missing home section");
  });
  it("rejects approved reviews without both purchase verification and publication permission", () => {
    const review = { id: "sample", status: "approved", quote: "検証用の架空文章", displayName: "検証用", verifiedPurchase: true, publicationConsent: true };
    for (const overrides of [{ verifiedPurchase: false }, { publicationConsent: false }]) {
      expect(homeContentSchema.safeParse({ ...homeContent, reviews: { ...homeContent.reviews, items: [{ ...review, ...overrides }] } }).success).toBe(false);
    }
  });
  it("accepts only local editorial photo paths and requires registered files to exist", () => {
    const item = { id: "sample", productSlug: "bloom-box-m", status: "approved", alt: "検証用", caption: "検証用" };
    for (const src of ["/images/products/../secret.png", "https://untrusted.example/photo.png", "/images/products/test.svg", "/images/products/bloombox-blue-concept.png", "/images/products/unregistered-photo.jpg"]) {
      expect(homeContentSchema.safeParse({ ...homeContent, gallery: { ...homeContent.gallery, items: [{ ...item, src }] } }).success).toBe(false);
    }
    const photos = [...homeContent.gallery.items, ...homeContent.reviews.items.flatMap((item) => item.photo ? [item.photo] : [])];
    for (const photo of photos) expect(existsSync(resolve("public", `.${photo.src}`))).toBe(true);
  });
});
