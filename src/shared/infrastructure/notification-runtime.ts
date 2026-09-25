import { DeliverNotifications, type NotificationDeliveryResult } from "@/modules/notification/public";
import { PostgresNotificationQueue } from "@/modules/notification/infrastructure/postgres-notification-queue";
import { PostgresUndeliveredNotifications } from "@/modules/notification/infrastructure/postgres-undelivered-notifications";
import { ResendEmailSender } from "@/modules/notification/infrastructure/resend-email-sender";
import { getWorkerDatabaseClient } from "./database/database-connections";
import { loadNotificationConfig } from "./config/notification-config";
import { loadDataProtectionConfig } from "./config/data-protection-config";
import { notificationContent } from "./content/notification-content";
import { AesGcmDataProtector } from "./security/aes-gcm-data-protector";
import { reportUnexpectedError } from "./observability/report-unexpected-error";

export type NotificationRunResult = Readonly<{ disabled: true }> | Readonly<{ error: true }> | NotificationDeliveryResult;

/**
 * Sends pending buyer notifications. A notification failure never fails the commerce worker run:
 * orders, payments and inventory stay authoritative and delivery is retried on the next run.
 */
export async function deliverBuyerNotifications(): Promise<NotificationRunResult> {
  try {
    const config = loadNotificationConfig();
    if (!config.enabled || !config.live) return { disabled: true };
    const report = (error: unknown) => { reportUnexpectedError(error, { operation: "notification_delivery" }); };
    return await new DeliverNotifications(
      new PostgresNotificationQueue(getWorkerDatabaseClient(), new AesGcmDataProtector(loadDataProtectionConfig())),
      new ResendEmailSender({ apiUrl: config.apiUrl, apiKey: config.apiKey, from: config.from, replyTo: config.replyTo }),
      notificationContent,
      config.origin,
      report,
    ).execute();
  } catch (error) {
    reportUnexpectedError(error, { operation: "notification_delivery" });
    return { error: true };
  }
}

/**
 * Recent buyer notifications that will not be delivered. Counted whether delivery is enabled or not, so an operator
 * still follows up on failures recorded before delivery was switched off.
 */
export function countUndeliveredBuyerNotifications(): Promise<number> {
  return new PostgresUndeliveredNotifications(getWorkerDatabaseClient()).count();
}
