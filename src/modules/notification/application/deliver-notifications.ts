import {
  NOTIFICATION_BATCH_LIMIT,
  NOTIFICATION_MAX_ATTEMPTS,
  composeNotification,
  notificationRetryDelaySeconds,
  type NotificationCopy,
  type NotificationKind,
  type OrderNotificationFacts,
  type ShipmentFacts,
} from "../domain/notification";

export type ClaimedNotification = Readonly<{
  /** The outbox event ID; also the provider idempotency key, so a resend after a lost acknowledgement is deduplicated. */
  eventId: string;
  lease: string;
  kind: NotificationKind;
  attempts: number;
  orderId: string;
  shipment: ShipmentFacts | null;
}>;
export type NotificationFacts = Readonly<{ email: string; order: OrderNotificationFacts }>;
/** Why a notification is permanently not sent. Never contains personal data. */
export type NotificationSkipReason = "NO_BUYER_EMAIL" | "ORDER_NOT_ACTIVE" | "ORDER_NOT_FOUND" | "REJECTED";

export interface NotificationQueue {
  claim(limit: number): Promise<readonly ClaimedNotification[]>;
  /** Current order facts and the buyer's contact email, or the reason there is nothing to send. */
  facts(notification: ClaimedNotification): Promise<NotificationFacts | NotificationSkipReason>;
  complete(notification: ClaimedNotification, providerMessageId: string): Promise<void>;
  retry(notification: ClaimedNotification, errorCode: string, delaySeconds: number): Promise<void>;
  fail(notification: ClaimedNotification, errorCode: string): Promise<void>;
}

export type OutgoingEmail = Readonly<{ to: string; subject: string; text: string; idempotencyKey: string }>;
export interface EmailSender {
  send(email: OutgoingEmail): Promise<string>;
}
/** The provider refused this message; retrying the same request cannot succeed. */
export class EmailRejectedError extends Error {
  constructor() {
    super("Email provider rejected the message");
    this.name = "EmailRejectedError";
  }
}

export type NotificationDeliveryResult = { sent: number; retried: number; failed: number; skipped: number };

export class DeliverNotifications {
  constructor(
    private readonly queue: NotificationQueue,
    private readonly sender: EmailSender,
    private readonly copy: NotificationCopy,
    private readonly origin: string,
    private readonly report: (error: unknown) => void,
  ) {}

  async execute(limit = NOTIFICATION_BATCH_LIMIT): Promise<NotificationDeliveryResult> {
    const result: NotificationDeliveryResult = { sent: 0, retried: 0, failed: 0, skipped: 0 };
    for (const notification of await this.queue.claim(limit)) {
      try {
        // Facts are re-read at send time, so a cancelled order or purged contact is not mailed on a retry.
        const facts = await this.queue.facts(notification);
        if (typeof facts === "string") {
          await this.queue.fail(notification, facts);
          result.skipped++;
          continue;
        }
        const message = composeNotification(notification.kind, facts.order, notification.shipment, this.copy, this.origin);
        const messageId = await this.sender.send({ to: facts.email, ...message, idempotencyKey: notification.eventId });
        await this.queue.complete(notification, messageId);
        result.sent++;
      } catch (error) {
        if (error instanceof EmailRejectedError) {
          await this.queue.fail(notification, "REJECTED");
          result.failed++;
          continue;
        }
        this.report(error);
        if (notification.attempts >= NOTIFICATION_MAX_ATTEMPTS) {
          await this.queue.fail(notification, "RETRY_EXHAUSTED");
          result.failed++;
        } else {
          await this.queue.retry(notification, "SEND_FAILED", notificationRetryDelaySeconds(notification.attempts));
          result.retried++;
        }
      }
    }
    return result;
  }
}
