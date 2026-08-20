import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "./postgres-client";

export type DataRetentionResult = Readonly<{
  purchaseIntentsExpired: number;
  webhookPayloadsPurged: number;
  purchaseIntentPiiPurged: number;
}>;

export class PostgresDataRetentionJob {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly createId: () => string = randomUUID,
  ) {}

  async execute(now: Date = new Date()): Promise<DataRetentionResult> {
    return this.sql.begin(async (transaction) => {
      const expiredPurchaseIntents = await transaction`
        UPDATE bloombox.purchase_intents
        SET status = 'EXPIRED', version = version + 1, updated_at = ${now}
        WHERE status IN ('DRAFT', 'READY_FOR_CHECKOUT')
          AND expires_at <= ${now}
        RETURNING id
      `;
      for (const intent of expiredPurchaseIntents) {
        await transaction`
          INSERT INTO bloombox.outbox_events (
            id, aggregate_type, aggregate_id, event_type, event_version,
            payload, occurred_at, available_at
          ) VALUES (
            ${this.createId()}, 'PurchaseIntent', ${intent.id},
            'checkout.purchase_intent.expired', 1,
            ${transaction.json({ purchaseIntentId: intent.id, status: "EXPIRED" })},
            ${now}, ${now}
          )
        `;
        await transaction`
          INSERT INTO bloombox.audit_logs (
            id, actor_type, action, resource_type, resource_id,
            safe_metadata, occurred_at, idempotency_key
          ) VALUES (
            ${this.createId()}, 'SYSTEM', 'checkout.purchase_intent.expired',
            'PurchaseIntent', ${intent.id}, ${transaction.json({ reason: "TTL_EXPIRED" })},
            ${now}, ${`purchase-intent-expiry:${intent.id}`}
          ) ON CONFLICT DO NOTHING
        `;
      }
      const webhookPayloads = await transaction`
        UPDATE bloombox.webhook_inbox
        SET payload_key_id = NULL, payload_ciphertext = NULL, payload_purged_at = ${now}
        WHERE payload_purged_at IS NULL
          AND payload_expires_at <= ${now}
          AND status IN ('PROCESSED', 'FAILED')
        RETURNING id
      `;
      const purchaseIntents = await transaction`
        UPDATE bloombox.purchase_intents
        SET
          pii_key_id = NULL,
          recipient_ciphertext = NULL,
          gift_message_ciphertext = NULL,
          pii_purged_at = ${now},
          version = version + 1,
          updated_at = ${now}
        WHERE pii_purged_at IS NULL
          AND pii_retention_expires_at <= ${now}
          AND status IN ('CONVERTED', 'EXPIRED', 'ABANDONED')
        RETURNING id
      `;
      return {
        purchaseIntentsExpired: expiredPurchaseIntents.length,
        webhookPayloadsPurged: webhookPayloads.length,
        purchaseIntentPiiPurged: purchaseIntents.length,
      };
    });
  }
}
