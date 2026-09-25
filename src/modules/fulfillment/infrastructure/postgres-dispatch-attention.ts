import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { getDispatchAttentionCutoff } from "../domain/delivery-date";
import { AWAITING_DISPATCH_STATUSES } from "../domain/fulfillment-status";

const countRow = z.object({ awaiting: z.number().int().nonnegative() });

/**
 * Counts confirmed native orders that are still not shipped although their delivery date is near or already past.
 * The count clears on its own once each order is shipped or cancelled, so an alert stays open exactly as long as a
 * gift is at risk. Only a count leaves the database: no order, recipient, or address detail.
 */
export class PostgresDispatchAttention {
  constructor(private readonly sql: DatabaseClient, private readonly now: () => Date = () => new Date()) {}

  async count(): Promise<number> {
    const rows = await this.sql`
      SELECT count(DISTINCT o.id)::int AS awaiting
      FROM bloombox.orders AS o
      JOIN bloombox.fulfillments AS f ON f.order_id = o.id
      JOIN bloombox.order_gift_snapshots AS g ON g.order_id = o.id
      WHERE o.commerce_provider = 'STRIPE'
        AND o.status = 'CONFIRMED'
        AND f.status IN ${this.sql(AWAITING_DISPATCH_STATUSES)}
        AND g.delivery_date <= ${getDispatchAttentionCutoff(this.now())}::date
    `;
    return countRow.parse(rows[0]).awaiting;
  }
}
