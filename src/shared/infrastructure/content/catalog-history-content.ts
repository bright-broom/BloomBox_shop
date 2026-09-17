import { z } from "zod";
import source from "../../../../content/catalog-history.json";
const text = z.string().trim().min(1).max(600);
export const catalogHistoryContent = z.object({ title: text, lead: text, link: text, productId: text, productHint: text, kind: text, catalog: text, stock: text, search: text, empty: text, initial: text, invalid: text, unavailable: text, back: text, next: text, first: text, before: text, after: text, operator: text, request: text, version: text, created: text, unchanged: text, unset: text, received: text, correction: text, delta: text, quantity: text, stockNote: text, timeZone: text, pagination: text }).strict().parse(source);
