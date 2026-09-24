import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import type { OrderDeliveryDateChangeRecord, OrderDeliveryDateStore } from "../application/change-order-delivery-date";
import { OrderDeliveryDateChangeError, type OrderDeliveryDateCommand, type OrderDeliveryDatePlan } from "../domain/order-delivery-date-change";

const uuid = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const factsRow = z.object({
  status: z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"]),
  confirmed_at: z.date().nullable(),
  delivery_date: date,
  pii_purged_at: z.date().nullable(),
});
const changeRow = z.object({ order_id: uuid, previous_date: date, next_date: date, reason: z.string().min(1), occurred_at: z.date() });

/** Writes the delivery date of the order's own gift snapshot; the fulfillment console asks for the change. */
export class PostgresOrderDeliveryDateStore implements OrderDeliveryDateStore {
  constructor(private readonly tx: DatabaseTransaction) {}

  async lockFacts(orderId: string) {
    if (!uuid.safeParse(orderId).success) throw new OrderDeliveryDateChangeError("INVALID");
    const [row] = await this.tx`
      SELECT orders.status, orders.confirmed_at, gift.delivery_date::text AS delivery_date, gift.pii_purged_at
      FROM bloombox.order_gift_snapshots gift
      JOIN bloombox.orders orders ON orders.id = gift.order_id
      WHERE gift.order_id = ${orderId}::uuid AND orders.commerce_provider = 'STRIPE'
      FOR UPDATE OF gift FOR SHARE OF orders`;
    if (!row) return null;
    const facts = factsRow.parse(row);
    // Dispatch is decided by the fulfillment records, never by the operator's claim in the form.
    const fulfillments = await this.tx`SELECT status FROM bloombox.fulfillments WHERE order_id = ${orderId}::uuid ORDER BY id FOR SHARE`;
    const shipments = await this.tx`
      SELECT shipment.id FROM bloombox.shipments shipment
      JOIN bloombox.fulfillments fulfillment ON fulfillment.id = shipment.fulfillment_id
      WHERE fulfillment.order_id = ${orderId}::uuid LIMIT 1`;
    return {
      orderStatus: facts.status,
      confirmedAt: facts.confirmed_at,
      deliveryDate: facts.delivery_date,
      piiPurged: facts.pii_purged_at !== null,
      fulfillmentStatuses: fulfillments.map((entry) => z.string().parse(entry.status)),
      hasShipment: shipments.length !== 0,
    };
  }

  async findChange(operatorId: string, requestId: string): Promise<OrderDeliveryDateChangeRecord | null> {
    if (!uuid.safeParse(operatorId).success || !uuid.safeParse(requestId).success) throw new OrderDeliveryDateChangeError("INVALID");
    const [row] = await this.tx`
      SELECT order_id, previous_date::text AS previous_date, next_date::text AS next_date, reason, occurred_at
      FROM bloombox.order_delivery_date_changes
      WHERE operator_id = ${operatorId}::uuid AND request_id = ${requestId}::uuid`;
    if (!row) return null;
    const value = changeRow.parse(row);
    return { orderId: value.order_id, previousDate: value.previous_date, nextDate: value.next_date,
      reason: value.reason, occurredAt: value.occurred_at.toISOString() };
  }

  async apply(plan: OrderDeliveryDatePlan, command: OrderDeliveryDateCommand, operatorId: string) {
    if (!uuid.safeParse(operatorId).success) throw new OrderDeliveryDateChangeError("INVALID");
    const updated = await this.tx`
      UPDATE bloombox.order_gift_snapshots
      SET delivery_date = ${plan.nextDate}::date, retention_expires_at = ${plan.retentionExpiresAt}
      WHERE order_id = ${command.orderId}::uuid AND delivery_date = ${plan.previousDate}::date AND pii_purged_at IS NULL
      RETURNING order_id`;
    if (updated.length !== 1) throw new OrderDeliveryDateChangeError("CONFLICT");
    await this.tx`
      INSERT INTO bloombox.order_delivery_date_changes (id, order_id, operator_id, request_id, previous_date, next_date, reason)
      VALUES (${randomUUID()}, ${command.orderId}::uuid, ${operatorId}::uuid, ${command.requestId}::uuid,
        ${plan.previousDate}::date, ${plan.nextDate}::date, ${plan.reason})`;
  }

  /** History for the operator's own screen; it holds no personal data, only dates and the stated reason. */
  async history(orderId: string, limit: number): Promise<readonly OrderDeliveryDateChangeRecord[]> {
    if (!uuid.safeParse(orderId).success || !Number.isSafeInteger(limit) || limit <= 0) throw new OrderDeliveryDateChangeError("INVALID");
    const rows = await this.tx`
      SELECT order_id, previous_date::text AS previous_date, next_date::text AS next_date, reason, occurred_at
      FROM bloombox.order_delivery_date_changes
      WHERE order_id = ${orderId}::uuid ORDER BY occurred_at DESC, id LIMIT ${limit}`;
    return rows.map((row) => {
      const value = changeRow.parse(row);
      return { orderId: value.order_id, previousDate: value.previous_date, nextDate: value.next_date,
        reason: value.reason, occurredAt: value.occurred_at.toISOString() };
    });
  }
}
