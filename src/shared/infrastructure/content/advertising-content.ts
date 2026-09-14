import { z } from "zod";
import source from "../../../../content/advertising.json";
const text = z.string().min(1).max(600);
export const advertisingContent = z.object({ title: text, body: text, accept: text, reject: text, settings: text, privacy: text, note: text, preview: text, error: text, saving: text, close: text }).strict().parse(source);
