import { z } from "zod";
import { REQUEST_REPLIED_PLACEHOLDERS, placeholdersIn, unknownPlaceholders, type NotificationCopy } from "@/modules/notification/public";
import source from "../../../../content/notifications.json";

const line = z.string().max(400).refine((value) => unknownPlaceholders(value).length === 0, "Unknown placeholder");
const template = z.object({ subject: line.pipe(z.string().min(1).max(150)).refine((value) => !/[\r\n]/.test(value)), body: z.array(line).min(1).max(40) }).strict();
const carrier = z.string().trim().min(1).max(40);
/** A reply notice must not learn to carry the gift's details, so its wording is limited to the allowed names. */
const replyLine = line.refine((value) => placeholdersIn(value).every((name) => (REQUEST_REPLIED_PLACEHOLDERS as readonly string[]).includes(name)),
  "A reply notice may only name the order and where to read the answer");
const replyTemplate = z.object({ subject: replyLine.pipe(z.string().min(1).max(150)).refine((value) => !/[\r\n]/.test(value)), body: z.array(replyLine).min(1).max(40) }).strict();

export const notificationContentSchema = z.object({
  orderConfirmed: template,
  orderShipped: template,
  requestReplied: replyTemplate,
  carriers: z.object({ YAMATO: carrier, SAGAWA: carrier, JAPAN_POST: carrier }).strict(),
  signature: z.array(line).min(1).max(20),
}).strict();

export const notificationContent: NotificationCopy = notificationContentSchema.parse(source);
