import site from "../../../../content/site.json";
import { z } from "zod";

const siteContentSchema = z.object({
  brandName: z.string().trim().min(1).max(80),
  defaultTitle: z.string().trim().min(1).max(120),
  titleTemplate: z.string().includes("%s"),
  description: z.string().trim().min(1).max(200),
  contactEmail: z.email(),
  serviceMessages: z.array(z.string().trim().min(1).max(80)).min(1).max(4),
  catalog: z.object({
    emptyMessage: z.string().trim().min(1).max(160),
  }),
  hero: z.object({
    eyebrow: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(80),
    emphasis: z.string().trim().min(1).max(80),
    lead: z.array(z.string().trim().min(1).max(120)).min(1).max(3),
    imageUrl: z.url(),
    imageAlt: z.string().trim().min(1).max(160),
    verticalCopy: z.string().trim().min(1).max(100),
    edition: z.string().trim().min(1).max(100),
  }),
  footer: z.object({
    tagline: z.string().trim().min(1).max(120),
    originNote: z.string().trim().min(1).max(120),
    copyrightHolder: z.string().trim().min(1).max(80),
  }),
});

export const siteContent = Object.freeze(siteContentSchema.parse(site));
