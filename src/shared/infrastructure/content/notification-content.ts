import { z } from "zod";
import { unknownPlaceholders, type NotificationCopy } from "@/modules/notification/public";
import source from "../../../../content/notifications.json";

const line = z.string().max(400).refine((value) => unknownPlaceholders(value).length === 0, "Unknown placeholder");
const template = z.object({ subject: line.pipe(z.string().min(1).max(150)).refine((value) => !/[\r\n]/.test(value)), body: z.array(line).min(1).max(40) }).strict();
const carrier = z.string().trim().min(1).max(40);

export const notificationContentSchema = z.object({
  orderConfirmed: template,
  orderShipped: template,
  carriers: z.object({ YAMATO: carrier, SAGAWA: carrier, JAPAN_POST: carrier }).strict(),
  signature: z.array(line).min(1).max(20),
}).strict();

export const notificationContent: NotificationCopy = notificationContentSchema.parse(source);
