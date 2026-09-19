import site from "../../../../content/site.json";
import { z } from "zod";

const shortCopy = z.string().trim().min(1).max(120);
const sectionCopy = z.object({
  eyebrow: shortCopy,
  title: shortCopy,
  description: z.string().trim().min(1).max(240),
  action: shortCopy,
});

/** A footer link group: a short English label above its Japanese title. */
const footerGroup = z.object({ label: z.string().trim().regex(/^[A-Z ]{1,20}$/), title: z.string().trim().min(1).max(30) }).strict();

const siteContentSchema = z.object({
  brandName: z.string().trim().min(1).max(80),
  defaultTitle: z.string().trim().min(1).max(120),
  titleTemplate: z.string().includes("%s"),
  description: z.string().trim().min(1).max(200),
  contactEmail: z.email(),
  previewServiceMessage: z.string().trim().min(1).max(80),
  serviceMessages: z.array(z.string().trim().min(1).max(80)).min(1).max(4),
  catalog: z.object({
    emptyMessage: z.string().trim().min(1).max(160),
    noResultsMessage: z.string().trim().min(1).max(160),
  }),
  hero: z.object({
    eyebrow: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(80),
    emphasis: z.string().trim().min(1).max(80),
    lead: z.array(z.string().trim().min(1).max(120)).min(1).max(3),
    imageUrl: z.url(),
    imageAlt: z.string().trim().min(1).max(160),
    displayTitle: z.string().trim().regex(/^[A-Za-z ]+$/).max(16),
    primaryAction: shortCopy,
    secondaryAction: shortCopy,
  }),
  home: z.object({
    intro: sectionCopy.extend({ title: z.array(shortCopy).min(1).max(3) }),
    collection: sectionCopy,
    guide: sectionCopy.extend({
      steps: z.array(z.object({ title: shortCopy, description: shortCopy })).length(3),
    }),
  }),
  footer: z.object({
    tagline: z.string().trim().min(1).max(120),
    originNote: z.string().trim().min(1).max(120),
    copyrightHolder: z.string().trim().min(1).max(80),
    eyebrow: z.string().trim().min(1).max(40),
    action: z.string().trim().min(1).max(30),
    contact: z.string().trim().min(1).max(30),
    hoursLabel: z.string().trim().min(1).max(30),
    backToTop: z.string().trim().min(1).max(30),
    groups: z.object({ shop: footerGroup, support: footerGroup, account: footerGroup, about: footerGroup }).strict(),
  }),
});

export const siteContent = Object.freeze(siteContentSchema.parse(site));
