import { z } from "zod";
import source from "../../../../content/catalog-management.json";
const text = z.string().trim().min(1).max(600);
export const catalogManagementContent = z.object({
shippingLabel: text, shippingHint: text, title: text, lead: text, newProduct: text, products: text, empty: text, login: text, refresh: text, next: text, first: text, save: text, saving: text, stockSave: text, stockTitle: text, stockHint: text, stockMeaning: text, onHand: text, reserved: text, sellable: text, unregistered: text, imageHint: text, listHint: text, draftHint: text, reason: text, delta: text, received: text, correction: text, edit: text, history: text, noHistory: text, yes: text, no: text,
labels: z.object({slug: text, name: text, subtitle: text, description: text, price: text, imageUrl: text, imageAlt: text, palette: text, occasions: text, flowers: text, grower: text, status: text, available: text}).strict(),
statuses: z.object({DRAFT: text, PUBLISHED: text, ARCHIVED: text}).strict(),
messages: z.object({IDLE: z.literal(""), SAVED: text, INVALID: text, DENIED: text, CONFLICT: text, UNAVAILABLE: text}).strict(),
}).strict().parse(source);
