import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { DataProtectionError, type AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_LEASE_SECONDS,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_SEND_WINDOW_HOURS,
} from "../domain/notification";
import type {
  ClaimedNotification,
  NotificationFacts,
  NotificationQueue,
  NotificationSkipReason,
} from "../application/deliver-notifications";

const eventTypes = Object.keys(NOTIFICATION_EVENT_TYPES);
const uuid = z.uuid();
const claimedRow = z.discriminatedUnion("event_type", [
  z.object({ event_type: z.literal("order.confirmed"), id: uuid, attempts: z.number().int().positive(),
    payload: z.object({ orderId: uuid }) }),
  z.object({ event_type: z.literal("fulfillment.shipped"), id: uuid, attempts: z.number().int().positive(),
    payload: z.object({ orderId: uuid, carrier: z.enum(["YAMATO", "SAGAWA", "JAPAN_POST"]),
      trackingNumber: z.string().regex(/^[A-Z0-9]{8,32}$/) }) }),
]);
const factsRow = z.object({
  display_id: z.string().min(1),
  status: z.string(),
  commerce_provider: z.string(),
  total_minor: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string(),
  delivery_date: z.string(),
  // Both are cleared together once the order's personal data reaches its retention limit (P0-17).
  pii_key_id: z.string().nullable(),
  address_ciphertext: z.instanceof(Buffer).nullable(),
  product_name_snapshot: z.string().min(1),
  quantity: z.number().int().positive(),
});
/** Only the buyer's Checkout email is used. The shipping name and address belong to the gift recipient. */
const buyerContact = z.object({ customerDetails: z.object({ email: z.email().max(254).nullable().optional() }).nullable().optional() });

/**
 * Consumes notification events from the shared outbox under a lease. This is the only consumer of these
 * event types; a second consumer needs its own delivery record instead of the outbox status (ADR 0019).
 */
export class PostgresNotificationQueue implements NotificationQueue {
  constructor(private readonly sql: DatabaseClient, private readonly protector: AesGcmDataProtector) {}

  async claim(limit: number): Promise<readonly ClaimedNotification[]> {
    const lease = randomUUID();
    const rows = await this.sql`
      UPDATE bloombox.outbox_events
      SET locked_at = clock_timestamp(), locked_by = ${lease}, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM bloombox.outbox_events
        WHERE status = 'PENDING' AND event_type IN ${this.sql(eventTypes)}
          AND available_at <= clock_timestamp()
          AND occurred_at > clock_timestamp() - make_interval(hours => ${NOTIFICATION_SEND_WINDOW_HOURS})
          AND attempts < ${NOTIFICATION_MAX_ATTEMPTS}
          AND (locked_at IS NULL OR locked_at < clock_timestamp() - make_interval(secs => ${NOTIFICATION_LEASE_SECONDS}))
        ORDER BY available_at, occurred_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, event_type, attempts, payload
    `;
    const claimed: ClaimedNotification[] = [];
    for (const raw of rows) {
      const parsed = claimedRow.safeParse(raw);
      if (!parsed.success) {
        await this.finish(String(raw.id), lease, "FAILED", "INVALID_EVENT");
        continue;
      }
      const row = parsed.data;
      claimed.push({
        eventId: row.id,
        lease,
        kind: NOTIFICATION_EVENT_TYPES[row.event_type],
        attempts: row.attempts,
        orderId: row.payload.orderId,
        shipment: row.event_type === "fulfillment.shipped"
          ? { carrier: row.payload.carrier, trackingNumber: row.payload.trackingNumber } : null,
      });
    }
    return claimed;
  }

  async facts(notification: ClaimedNotification): Promise<NotificationFacts | NotificationSkipReason> {
    const [raw] = await this.sql`
      SELECT o.display_id, o.status, o.commerce_provider, o.total_minor, o.currency,
        g.delivery_date::text AS delivery_date, g.pii_key_id, g.address_ciphertext,
        i.product_name_snapshot, i.quantity
      FROM bloombox.orders o
      JOIN bloombox.order_gift_snapshots g ON g.order_id = o.id
      JOIN bloombox.order_items i ON i.order_id = o.id AND i.position = 0
      WHERE o.id = ${notification.orderId}
    `;
    if (!raw) return "ORDER_NOT_FOUND";
    const row = factsRow.parse(raw);
    if (row.commerce_provider !== "STRIPE" || row.currency !== "JPY" || !["CONFIRMED", "CLOSED"].includes(row.status)) {
      return "ORDER_NOT_ACTIVE";
    }
    if (!row.address_ciphertext || !row.pii_key_id) return "NO_BUYER_EMAIL";
    let contact: unknown;
    try {
      contact = JSON.parse(this.protector.unprotect(
        { keyId: row.pii_key_id, ciphertext: row.address_ciphertext },
        `order:${notification.orderId}:address:v1`,
      ));
    } catch (error) {
      // A key problem is retried; only a readable record without an email is a permanent skip.
      if (error instanceof DataProtectionError) throw error;
      return "NO_BUYER_EMAIL";
    }
    const email = buyerContact.safeParse(contact);
    if (!email.success || !email.data.customerDetails?.email) return "NO_BUYER_EMAIL";
    return {
      email: email.data.customerDetails.email,
      order: {
        displayId: row.display_id,
        productName: row.product_name_snapshot,
        quantity: row.quantity,
        deliveryDate: row.delivery_date,
        totalYen: row.total_minor,
      },
    };
  }

  async complete(notification: ClaimedNotification, providerMessageId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      const updated = await tx`
        UPDATE bloombox.outbox_events
        SET status = 'PUBLISHED', published_at = clock_timestamp(), locked_at = NULL, locked_by = NULL, last_error_code = NULL
        WHERE id = ${notification.eventId} AND locked_by = ${notification.lease} AND status = 'PENDING'
        RETURNING id
      `;
      if (updated.length === 0) return;
      // Support can confirm a notification was accepted without storing the address or message.
      await tx`INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
        VALUES (${randomUUID()}, 'SYSTEM', ${`notification.${notification.kind.toLowerCase()}.sent`}, 'order', ${notification.orderId},
          ${tx.json({ eventId: notification.eventId, providerMessageId: providerMessageId.slice(0, 128) })}, clock_timestamp())`;
    });
  }

  async retry(notification: ClaimedNotification, errorCode: string, delaySeconds: number): Promise<void> {
    await this.sql`
      UPDATE bloombox.outbox_events
      SET locked_at = NULL, locked_by = NULL, last_error_code = ${errorCode},
        available_at = clock_timestamp() + make_interval(secs => ${delaySeconds})
      WHERE id = ${notification.eventId} AND locked_by = ${notification.lease} AND status = 'PENDING'
    `;
  }

  fail(notification: ClaimedNotification, errorCode: string): Promise<void> {
    return this.finish(notification.eventId, notification.lease, "FAILED", errorCode);
  }

  private async finish(eventId: string, lease: string, status: "FAILED", errorCode: string): Promise<void> {
    await this.sql`
      UPDATE bloombox.outbox_events
      SET status = ${status}, locked_at = NULL, locked_by = NULL, last_error_code = ${errorCode}
      WHERE id = ${eventId} AND locked_by = ${lease} AND status = 'PENDING'
    `;
  }
}
