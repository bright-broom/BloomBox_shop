import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { UNRECORDED_CHECKOUT_REVIEW_ACTION } from "./stripe-unrecorded-checkout-recovery";

export type CommerceWorkerAttention = Readonly<{
  /** Stripe events that exhausted their processing attempts and still await a supported resolution. */
  failedInboxEvents: number;
  /** Stripe-selected purchases without a recorded session whose provider lookup could not be released automatically. */
  unrecordedCheckoutsAwaitingReview: number;
  requiresAttention: boolean;
}>;

const attentionRowSchema = z.object({
  failed_inbox_events: z.number().int().nonnegative(),
  unrecorded_checkouts_awaiting_review: z.number().int().nonnegative(),
});

/**
 * Counts unresolved conditions on every run. The worker incident must stay open until they are resolved,
 * not only during the single run in which they first appear (docs/operations/COMMERCE_WORKER_INCIDENTS.md).
 * Only counts are returned: no event payload, customer, or purchase detail leaves the database.
 */
export class PostgresCommerceWorkerAttention {
  constructor(private readonly sql: DatabaseClient) {}

  async execute(): Promise<CommerceWorkerAttention> {
    const rows = await this.sql`
      SELECT
        (
          SELECT count(*) FROM bloombox.webhook_inbox
          WHERE commerce_provider = 'STRIPE' AND status = 'FAILED'
        )::int AS failed_inbox_events,
        (
          SELECT count(*) FROM bloombox.purchase_intents AS intent
          WHERE intent.status = 'READY_FOR_CHECKOUT'
            AND intent.commerce_provider = 'STRIPE'
            AND intent.external_checkout_id IS NULL
            AND EXISTS (
              SELECT 1 FROM bloombox.audit_logs AS review
              WHERE review.resource_type = 'PurchaseIntent'
                AND review.resource_id = intent.id
                AND review.action = ${UNRECORDED_CHECKOUT_REVIEW_ACTION}
            )
        )::int AS unrecorded_checkouts_awaiting_review
    `;
    const row = attentionRowSchema.parse(rows[0]);
    return commerceWorkerAttention(row.failed_inbox_events, row.unrecorded_checkouts_awaiting_review);
  }
}

export function commerceWorkerAttention(failedInboxEvents: number, unrecordedCheckoutsAwaitingReview: number): CommerceWorkerAttention {
  return {
    failedInboxEvents,
    unrecordedCheckoutsAwaitingReview,
    requiresAttention: failedInboxEvents > 0 || unrecordedCheckoutsAwaitingReview > 0,
  };
}
