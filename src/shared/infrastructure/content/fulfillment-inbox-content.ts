import { z } from "zod";
import source from "../../../../content/fulfillment-inbox.json";
const text = z.string().trim().min(1).max(600);
export const fulfillmentInboxContent = z.object({
  title: text, lead: text, shopLabel: text, shopHint: text, shopPlaceholder: text, search: text,
  empty: text, denied: text, invalid: text, unavailable: text, order: text, delivery: text, total: text,
  status: text, detail: text, next: text, first: text, login: text, testMode: text, liveMode: text, listNote: text, viewedAt: text,
}).strict().parse(source);
