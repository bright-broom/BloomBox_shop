import storefront from "../../../../content/storefront.json";
import { z } from "zod";

const storefrontItemSchema = z.object({
  term: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
});

const storefrontSectionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.array(z.string().trim().min(1).max(800)).max(8),
  items: z.array(storefrontItemSchema).max(20).optional(),
});

const storefrontPageSchema = z.object({
  slug: z.enum([
    "about",
    "guide",
    "faq",
    "shipping-returns",
    "privacy",
    "terms",
    "commercial-transactions",
    "contact",
  ]),
  eyebrow: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(120),
  lead: z.string().trim().min(1).max(300),
  notice: z.string().trim().min(1).max(500).optional(),
  kind: z.enum(["standard", "faq", "disclosure"]).default("standard"),
  sections: z.array(storefrontSectionSchema).min(1).max(16),
});

const storefrontContentSchema = z.object({
  publicationStatus: z.enum(["draft", "approved"]),
  pages: z.array(storefrontPageSchema).length(8),
}).superRefine((value, context) => {
  const slugs = new Set(value.pages.map((page) => page.slug));
  if (slugs.size !== value.pages.length) {
    context.addIssue({ code: "custom", message: "Storefront page slugs must be unique" });
  }
});

export const storefrontContent = Object.freeze(storefrontContentSchema.parse(storefront));
export type StorefrontPage = (typeof storefrontContent.pages)[number];

export function findStorefrontPage(slug: string): StorefrontPage | undefined {
  return storefrontContent.pages.find((page) => page.slug === slug);
}
