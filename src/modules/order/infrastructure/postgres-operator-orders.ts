import { z } from "zod";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import {
  OPERATOR_ORDER_PAGE_SIZE,
  type OperatorOrderFilter,
  type OperatorOrderPage,
  type OperatorOrderReport,
} from "../application/operator-orders";
const integer = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const rowSchema = z.object({
  id: z.uuid(),
  display_id: z.string(),
  customer_id: z.uuid().nullable(),
  created_at: z.date(),
  total_minor: integer,
  currency: z.literal("JPY"),
  status: z.string(),
  payment_states: z.array(z.string()),
  fulfillment_states: z.array(z.string()),
});
/** Non-PII native order summaries. Called only inside the audited customer-support transaction. */
export class PostgresOperatorOrders {
  constructor(private readonly sql: DatabaseTransaction) {}
  async list(filter: OperatorOrderFilter): Promise<OperatorOrderPage> {
    const rows = await this.sql`WITH visible AS (
      SELECT o.id, o.display_id, o.created_at, o.total_minor, o.currency, o.status,
        CASE WHEN c.status <> 'ANONYMIZED' THEN c.id ELSE NULL END AS customer_id,
        ARRAY(SELECT DISTINCT p.status FROM bloombox.payments p WHERE p.order_id=o.id ORDER BY p.status) AS payment_states,
        ARRAY(SELECT DISTINCT f.status FROM bloombox.fulfillments f WHERE f.order_id=o.id ORDER BY f.status) AS fulfillment_states
      FROM bloombox.orders o LEFT JOIN bloombox.buyers b ON b.id=o.buyer_id
      LEFT JOIN bloombox.customer_accounts c ON c.id=b.customer_id
      WHERE o.commerce_provider='STRIPE' AND o.currency='JPY'
        AND (${!filter.q} OR o.display_id=${filter.q ?? ""} OR o.id::text=${filter.q ?? ""})
        AND (${!filter.status} OR o.status=${filter.status ?? ""})
    ), filtered AS (SELECT * FROM visible
      WHERE (${!filter.payment} OR ${filter.payment ?? ""}=ANY(payment_states))
        AND (${!filter.fulfillment} OR ${filter.fulfillment ?? ""}=ANY(fulfillment_states)))
    SELECT * FROM filtered WHERE (${!filter.after} OR (created_at,id) <
      (SELECT created_at,id FROM filtered WHERE id=${filter.after ?? null}::uuid))
    ORDER BY created_at DESC,id DESC LIMIT ${OPERATOR_ORDER_PAGE_SIZE + 1}`;
    const orders = rows.slice(0, OPERATOR_ORDER_PAGE_SIZE).map((value) => {
      const r = rowSchema.parse(value);
      return {
        id: r.id,
        name: r.display_id,
        customerId: r.customer_id,
        orderedAt: r.created_at.toISOString(),
        totalYen: r.total_minor,
        status: r.status,
        payment: r.payment_states,
        fulfillment: r.fulfillment_states,
      };
    });
    return {
      orders,
      next: rows.length > OPERATOR_ORDER_PAGE_SIZE ? orders.at(-1)!.id : null,
    };
  }
  async report(days: number): Promise<OperatorOrderReport> {
    // A single SQL snapshot and Japan calendar boundaries; joins never multiply order money.
    const [raw] = await this.sql`WITH bounds AS (
      SELECT date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Tokyo') - (${days}::int-1)*interval '1 day' AS start_day,
        clock_timestamp() AS finish
    ), facts AS (
      SELECT o.total_minor,o.status,(o.created_at AT TIME ZONE 'Asia/Tokyo')::date AS day,
        ARRAY(SELECT DISTINCT p.status FROM bloombox.payments p WHERE p.order_id=o.id ORDER BY p.status) AS payments,
        ARRAY(SELECT DISTINCT f.status FROM bloombox.fulfillments f WHERE f.order_id=o.id ORDER BY f.status) AS fulfillments
      FROM bloombox.orders o,bounds
      WHERE o.commerce_provider='STRIPE' AND o.currency='JPY'
        AND o.created_at >= bounds.start_day AT TIME ZONE 'Asia/Tokyo' AND o.created_at <= bounds.finish
    ), daily AS (
      SELECT to_char(calendar.day,'YYYY-MM-DD') AS day,count(f.day)::text AS orders,
        coalesce(sum(f.total_minor) FILTER(WHERE f.status<>'CANCELLED'),0)::text AS value
      FROM bounds,generate_series(bounds.start_day,bounds.finish AT TIME ZONE 'Asia/Tokyo',interval '1 day') calendar(day)
      LEFT JOIN facts f ON f.day=calendar.day::date GROUP BY calendar.day ORDER BY calendar.day
    ) SELECT (SELECT start_day AT TIME ZONE 'Asia/Tokyo' FROM bounds) AS since,(SELECT finish FROM bounds) AS until,
      count(*)::text AS orders,coalesce(sum(total_minor) FILTER(WHERE status<>'CANCELLED'),0)::text AS value,
      count(*) FILTER(WHERE payments=ARRAY['CAPTURED']::text[])::text AS captured,
      count(*) FILTER(WHERE payments && ARRAY['REFUNDED','PARTIALLY_REFUNDED']::text[])::text AS refunds,
      count(*) FILTER(WHERE status='CONFIRMED' AND payments=ARRAY['CAPTURED']::text[] AND
        fulfillments && ARRAY['UNFULFILLED','PROCESSING','READY','ON_HOLD']::text[])::text AS awaiting,
      count(*) FILTER(WHERE status='CANCELLED')::text AS cancelled,
      (SELECT json_agg(daily) FROM daily) AS daily FROM facts`;
    const r = z
      .object({
        since: z.date(),
        until: z.date(),
        orders: integer,
        value: integer,
        captured: integer,
        refunds: integer,
        awaiting: integer,
        cancelled: integer,
        daily: z.array(
          z.object({ day: z.string(), orders: integer, value: integer }),
        ),
      })
      .parse(raw);
    return {
      days,
      since: r.since.toISOString(),
      until: r.until.toISOString(),
      orders: r.orders,
      orderValueYen: r.value,
      captured: r.captured,
      refunds: r.refunds,
      awaitingShipment: r.awaiting,
      cancelled: r.cancelled,
      daily: r.daily.map((d) => ({
        day: d.day,
        orders: d.orders,
        orderValueYen: d.value,
      })),
    };
  }
}
