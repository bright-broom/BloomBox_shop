import { z } from 'zod';
import type { DatabaseTransaction } from '@/shared/infrastructure/database/postgres-client';
import { SUPPORT_ORDER_PAGE_SIZE, type SupportOrderHistory } from '../application/support-order-history';
const rowSchema = z.object({ id: z.uuid(), display_id: z.string().min(1).max(100), created_at: z.date(),
  total_minor: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), currency: z.literal('JPY'),
  status: z.enum(['PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'CLOSED']),
  payment_states: z.array(z.string()).nullable(), fulfillment_states: z.array(z.string()).nullable() });
export class PostgresSupportOrderHistory implements SupportOrderHistory {
  constructor(private readonly sql: DatabaseTransaction) {}
  async findCustomer(orderReference: string) {
    const rows = await this.sql`SELECT buyer.customer_id FROM bloombox.orders orders
      JOIN bloombox.buyers buyer ON buyer.id = orders.buyer_id
      WHERE orders.display_id = ${orderReference} AND orders.commerce_provider = 'STRIPE'
        AND buyer.customer_id IS NOT NULL LIMIT 1`;
    return rows.length ? z.uuid().parse(rows[0].customer_id) : null;
  }
  async read(customerId: string, after?: string) {
    // The cursor identifies a position within this customer's history only.
    const rows = await this.sql`SELECT orders.id, orders.display_id, orders.created_at, orders.total_minor,
        orders.currency, orders.status, payment.states AS payment_states, fulfillment.states AS fulfillment_states
      FROM bloombox.orders orders JOIN bloombox.buyers buyer ON buyer.id = orders.buyer_id
      JOIN bloombox.customer_accounts customer ON customer.id = buyer.customer_id AND customer.status <> 'ANONYMIZED'
      LEFT JOIN LATERAL (SELECT array_agg(DISTINCT status ORDER BY status) AS states
        FROM bloombox.payments WHERE order_id = orders.id) payment ON TRUE
      LEFT JOIN LATERAL (SELECT array_agg(DISTINCT status ORDER BY status) AS states
        FROM bloombox.fulfillments WHERE order_id = orders.id) fulfillment ON TRUE
      WHERE buyer.customer_id = ${customerId}::uuid AND orders.commerce_provider = 'STRIPE'
        AND (${after === undefined} OR (orders.created_at, orders.id) < (
          SELECT previous.created_at, previous.id FROM bloombox.orders previous
          JOIN bloombox.buyers previous_buyer ON previous_buyer.id = previous.buyer_id
          WHERE previous.id = ${after ?? null}::uuid AND previous_buyer.customer_id = ${customerId}::uuid
            AND previous.commerce_provider = 'STRIPE'))
      ORDER BY orders.created_at DESC, orders.id DESC LIMIT ${SUPPORT_ORDER_PAGE_SIZE + 1}`;
    const orders = rows.slice(0, SUPPORT_ORDER_PAGE_SIZE).map((value) => {
      const row = rowSchema.parse(value);
      return { id: row.id, name: row.display_id, orderedAt: row.created_at.toISOString(), totalYen: row.total_minor,
        status: row.status, payment: row.payment_states ?? [], fulfillment: row.fulfillment_states ?? [] };
    });
    return { orders, next: rows.length > SUPPORT_ORDER_PAGE_SIZE ? orders.at(-1)!.id : null };
  }
}
