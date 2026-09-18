import { z } from "zod";
import source from "../../../../content/analytics.json";

const text = z.string().trim().min(1).max(600);
export const analyticsContent = z.object({
  title: text, body: text, note: text, privacy: text, accept: text, reject: text, settings: text, close: text,
}).strict().parse(source);
