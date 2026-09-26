import { z } from "zod";
import { productImageAssets } from "../config/native-catalog-image-config";
import source from "../../../../content/home.json";
import { findStorefrontPage } from "./storefront-content";

const text = z.string().trim().min(1).max(500);
const id = z.string().regex(/^[a-z0-9-]+$/).max(80);
const heading = z.object({ eyebrow: text, title: text });
// Editorial links are same-site routes, never arbitrary URLs or encoded redirects.
const href = z.string().regex(/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]*(?:#[a-z0-9-]+)?$/);
const photo = z.object({
  src: z.string().refine((src) => productImageAssets.some((asset) => asset.src === src && asset.kind === "photograph")),
  alt: text,
  caption: text,
}).strict();
// A registered design concept, never a photograph of the real product; the caption must say so.
const conceptImage = z.object({
  src: z.string().refine((src) => productImageAssets.some((asset) => asset.src === src && asset.kind === "concept")),
  alt: text,
}).strict();
const approval = z.enum(["draft", "approved"]);
const announcement = z.object({
  id, title: text, body: text, href: href.optional(),
  severity: z.enum(["info", "important"]),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
}).strict().refine((item) => Date.parse(item.startsAt) < Date.parse(item.endsAt), {
  message: "Announcement end must follow its start",
});
const sectionReference = z.object({
  page: z.enum(["about", "guide", "faq", "shipping-returns", "contact"]),
  section: id,
});

export const homeContentSchema = z.object({
  visual: z.object({
    shortcuts: z.object({ label: text, flowers: text, message: text, delivery: text }).strict(),
    diagram: z.object({
      flower: text, message: text, result: text, caption: text, cardEyebrow: text, image: conceptImage,
    }).strict(),
    occasions: heading.extend({ items: z.array(z.object({
      label: z.enum(["ありがとう", "誕生日", "記念日"]), note: text,
    }).strict()).length(3) }),
    deliverySteps: z.object({ label: text, items: z.array(text).length(3) }).strict(),
    accountLinks: z.object({ label: text, orders: text, favorites: text, addresses: text }).strict(),
    faqNote: text,
  }).strict(),
  announcementsTitle: text,
  announcements: z.array(announcement).max(10),
  gallery: heading.extend({ items: z.array(photo.extend({
    id, productSlug: id, status: approval,
  })).max(6) }),
  comparison: z.object({ title: text, pending: text, sizes: z.array(z.object({
    size: z.enum(["M", "L"]), status: approval, description: text,
    facts: z.array(z.object({ label: text, value: text }).strict()).min(1).max(4),
  }).strict()).max(2) }).strict(),
  delivery: heading.extend({ rangeLabel: text, previewLabel: text, note: text, action: text }),
  assurance: heading.extend({ draftNote: text, action: text,
    items: z.array(sectionReference.extend({
      icon: z.enum(["gift", "mail", "card", "help"]), title: text,
    })).min(1).max(4),
  }),
  faq: heading.extend({ mark: z.string().trim().min(1).max(8), sectionIds: z.array(id).min(3).max(5), action: text, contact: text }),
  membership: heading.extend({ description: text, benefitTitle: text, benefitNote: text, action: text, register: text }),
  reviews: heading.extend({ items: z.array(z.object({
    id, status: approval, quote: text, displayName: text,
    verifiedPurchase: z.boolean(), publicationConsent: z.boolean(),
    photo: photo.optional(),
  }).strict().refine((item) => item.status !== "approved" || (item.verifiedPurchase && item.publicationConsent), {
    message: "Published reviews require verified purchase and publication consent",
  })).max(6) }),
}).strict().superRefine((value, context) => {
  const groups = [value.announcements.map((item) => item.id), value.gallery.items.map((item) => item.id),
    value.reviews.items.map((item) => item.id), value.comparison.sizes.map((item) => item.size), value.faq.sectionIds];
  if (groups.some((keys) => new Set(keys).size !== keys.length)) {
    context.addIssue({ code: "custom", message: "Home content identifiers must be unique within each section" });
  }
  const refs = [...value.assurance.items, ...value.faq.sectionIds.map((section) => ({ page: "faq", section }))];
  for (const ref of refs) {
    if (!findStorefrontPage(ref.page)?.sections.some((section) => section.id === ref.section)) {
      context.addIssue({ code: "custom", message: `Missing storefront reference: ${ref.page}/${ref.section}` });
    }
  }
});

export const homeContent = Object.freeze(homeContentSchema.parse(source));
export type HomeContent = z.infer<typeof homeContentSchema>;

/** Publication window is start-inclusive/end-exclusive, using the server clock. */
export function activeHomeAnnouncements(content: HomeContent, now: Date) {
  return content.announcements.filter((item) => Date.parse(item.startsAt) <= now.getTime()
    && now.getTime() < Date.parse(item.endsAt))
    .sort((a, b) => Number(b.severity === "important") - Number(a.severity === "important"));
}

export function homeSection(page: string, sectionId: string) {
  const section = findStorefrontPage(page)?.sections.find((item) => item.id === sectionId);
  if (!section) throw new Error(`Missing home section: ${page}/${sectionId}`);
  return section;
}
