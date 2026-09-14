import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { CustomerOrderHistoryUnavailableError, type CustomerOrderHistoryQuery } from "../application/customer-order-history";
import type { CustomerOrderDetailQuery } from "../application/customer-order-detail";

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() }).strict();
const rowSchema = z.object({ id: z.uuid(), display_id: z.string().min(1).max(100), created_at: z.string(),
  currency: z.literal("JPY"), total_minor: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"]),
  items: z.array(z.object({ name: z.string().min(1), quantity: z.number().int().positive() })).default([]),
  payment_states: z.array(z.string()).nullable(), fulfillment_states: z.array(z.string()).nullable() });
const yen = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const detailSchema = rowSchema.extend({ subtotal_minor: yen, tax_minor: yen, shipping_minor: yen, discount_minor: yen,
  items: z.array(z.object({ name: z.string().min(1), quantity: z.number().int().positive(), currency: z.literal("JPY"),
    unit_minor: yen, total_minor: yen }).strict()).min(1) });
export class PostgresCustomerOrderHistory implements CustomerOrderHistoryQuery, CustomerOrderDetailQuery {
  constructor(private readonly sql: DatabaseClient) {}
  async readDetail(customerId: string, orderId: string) {
    try {
      z.uuid().parse(customerId);
      if (!z.uuid().safeParse(orderId).success) return null;
      // Ownership and all snapshots are read in one statement. Never join current catalog or recipient data.
      const rows = await this.sql`SELECT orders.id, orders.display_id, orders.currency, orders.total_minor, orders.status,
          orders.subtotal_minor, orders.tax_minor, orders.shipping_minor, orders.discount_minor,
          to_char(orders.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
          payment.states AS payment_states, fulfillment.states AS fulfillment_states,
          (SELECT jsonb_agg(jsonb_build_object('name', item.product_name_snapshot, 'quantity', item.quantity,
            'currency', item.currency, 'unit_minor', item.unit_amount_minor::text, 'total_minor', item.line_total_minor::text)
            ORDER BY item.position) FROM bloombox.order_items item WHERE item.order_id = orders.id) AS items
        FROM bloombox.orders orders JOIN bloombox.buyers buyer ON buyer.id = orders.buyer_id
        JOIN bloombox.customer_accounts customer ON customer.id = buyer.customer_id AND customer.status = 'ACTIVE'
        LEFT JOIN LATERAL (SELECT array_agg(DISTINCT status) AS states FROM bloombox.payments WHERE order_id = orders.id) payment ON TRUE
        LEFT JOIN LATERAL (SELECT array_agg(DISTINCT status) AS states FROM bloombox.fulfillments WHERE order_id = orders.id) fulfillment ON TRUE
        WHERE orders.id = ${orderId} AND buyer.customer_id = ${customerId} AND orders.commerce_provider = 'STRIPE'`;
      if (!rows.length) return null;
      const row = detailSchema.parse(rows[0]);
      return { id: row.id, name: row.display_id, orderedAt: cursorSchema.shape.createdAt.parse(row.created_at),
        totalYen: row.total_minor, subtotalYen: row.subtotal_minor, taxYen: row.tax_minor,
        shippingYen: row.shipping_minor, discountYen: row.discount_minor, cancelled: row.status === "CANCELLED",
        payment: onlyState(row.payment_states), fulfillment: onlyState(row.fulfillment_states),
        items: row.items.map((item) => ({ name: item.name, quantity: item.quantity, unitYen: item.unit_minor, totalYen: item.total_minor })),
        shipment: null };
    } catch { throw new CustomerOrderHistoryUnavailableError(); }
  }
  async read(customerId: string, after: string | null) {
    try {
      z.uuid().parse(customerId);
      if (after !== null && !/^[A-Za-z0-9_-]{1,2048}$/.test(after)) throw new CustomerOrderHistoryUnavailableError();
      // A cursor selects a position, never an account. Keep PostgreSQL microsecond precision.
      const cursor = after === null ? null : cursorSchema.parse(JSON.parse(Buffer.from(after, "base64url").toString("utf8")));
      const rows = await this.sql`SELECT orders.id, orders.display_id, orders.currency, orders.total_minor, orders.status,
          to_char(orders.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
          payment.states AS payment_states, fulfillment.states AS fulfillment_states,
          coalesce((SELECT jsonb_agg(jsonb_build_object('name', item.product_name_snapshot, 'quantity', item.quantity)
            ORDER BY item.position) FROM bloombox.order_items item WHERE item.order_id = orders.id), '[]'::jsonb) AS items
        FROM bloombox.orders orders JOIN bloombox.buyers buyer ON buyer.id = orders.buyer_id
        JOIN bloombox.customer_accounts customer ON customer.id = buyer.customer_id AND customer.status = 'ACTIVE'
        LEFT JOIN LATERAL (SELECT array_agg(DISTINCT status) AS states FROM bloombox.payments WHERE order_id = orders.id) payment ON TRUE
        LEFT JOIN LATERAL (SELECT array_agg(DISTINCT status) AS states FROM bloombox.fulfillments WHERE order_id = orders.id) fulfillment ON TRUE
        WHERE buyer.customer_id = ${customerId} AND orders.commerce_provider = 'STRIPE'
          AND (${cursor === null} OR (orders.created_at, orders.id) < (${cursor?.createdAt ?? null}::text::timestamptz, ${cursor?.id ?? null}::uuid))
        ORDER BY orders.created_at DESC, orders.id DESC LIMIT 11`;
      const values = rows.map((row) => rowSchema.parse(row));
      const page = values.slice(0, 10);
      const last = page.at(-1);
      return { orders: page.map((row) => ({ id: row.id, name: row.display_id, orderedAt: cursorSchema.shape.createdAt.parse(row.created_at),
        totalYen: row.total_minor, items: row.items, cancelled: row.status === "CANCELLED",
        payment: onlyState(row.payment_states), fulfillment: onlyState(row.fulfillment_states) })),
        nextCursor: values.length > 10 && last ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString("base64url") : null };
    } catch { throw new CustomerOrderHistoryUnavailableError(); }
  }
}
// Partial/multiple captures or split shipments need explicit summaries; do not invent a single success state.
function onlyState(states: string[] | null): string { return states?.length === 1 ? states[0] : "UNKNOWN"; }
