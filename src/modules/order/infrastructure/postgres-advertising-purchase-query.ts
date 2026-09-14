import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { AdvertisingPurchaseQuery } from "../application/advertising-purchase-query";
const row = z.object({ id: z.uuid(), confirmed_at: z.date(), total_minor: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.literal("JPY") });
export class PostgresAdvertisingPurchaseQuery implements AdvertisingPurchaseQuery {
  constructor(private readonly sql: DatabaseClient) {}
  async findConfirmedPurchase(intentId: string) {
    const rows = await this.sql`
      SELECT o.id, o.confirmed_at, o.total_minor, o.currency
      FROM bloombox.orders o JOIN bloombox.purchase_intents i ON i.id = o.purchase_intent_id
      WHERE i.id = ${intentId} AND i.commerce_provider = 'STRIPE'
        AND i.external_checkout_id ~ '^cs_live_[A-Za-z0-9]+$' AND i.status = 'CONVERTED'
        AND o.commerce_provider = 'STRIPE' AND o.status IN ('CONFIRMED', 'CLOSED')
        AND o.confirmed_at IS NOT NULL AND o.currency = 'JPY' AND o.total_minor > 0
        AND EXISTS (SELECT 1 FROM bloombox.payments p WHERE p.order_id = o.id)
        AND NOT EXISTS (SELECT 1 FROM bloombox.payments p WHERE p.order_id = o.id
          AND (p.status <> 'CAPTURED' OR p.currency <> o.currency OR p.commerce_provider <> 'STRIPE' OR p.amount_refunded_minor <> 0))
        AND (SELECT SUM(p.amount_captured_minor) FROM bloombox.payments p WHERE p.order_id = o.id) = o.total_minor
      LIMIT 1`;
    if (!rows.length) return null;
    const v = row.parse(rows[0]);
    return { orderId: v.id, confirmedAt: v.confirmed_at, value: v.total_minor, currency: v.currency };
  }
}
