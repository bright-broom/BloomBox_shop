import { z } from "zod";
import { money } from "@/shared/domain/money";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { OrderStatusQuery, OrderStatusRecord } from "../application/order-status-query";

const rowSchema = z.object({
  purchase_intent_status: z.enum([
    "DRAFT", "READY_FOR_CHECKOUT", "CHECKOUT_CREATED", "CONVERTED", "EXPIRED", "ABANDONED",
  ]),
  purchase_intent_display_id: z.string(),
  product_name: z.string(),
  quantity: z.number().int().positive(),
  delivery_date: z.string(),
  order_display_id: z.string().nullable(),
  order_status: z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"]).nullable(),
  payment_status: z.enum([
    "REQUIRES_PAYMENT_METHOD", "REQUIRES_ACTION", "PROCESSING", "AUTHORIZED", "CAPTURED",
    "PARTIALLY_REFUNDED", "REFUNDED", "FAILED", "CANCELLED", "DISPUTED",
  ]).nullable(),
  fulfillment_status: z.enum([
    "UNFULFILLED", "SCHEDULED", "PROCESSING", "READY", "SHIPPED", "DELIVERED",
    "CANCELLED", "RETURNED",
  ]).nullable(),
  catalog_product_id: z.string().min(1),
  total_minor: z.union([z.number(), z.string(), z.bigint()]).nullable(),
  currency: z.literal("JPY").nullable(),
  carrier_code: z.string().nullable(),
  tracking_reference: z.string().nullable(),
});

export class InvalidOrderStatusProjectionError extends Error {
  constructor() {
    super("Order status projection is invalid");
    this.name = "InvalidOrderStatusProjectionError";
  }
}

export class PostgresOrderStatusQuery implements OrderStatusQuery {
  constructor(private readonly sql: DatabaseClient) {}

  async findByCheckoutReference(reference: string): Promise<OrderStatusRecord | null> {
    const rows = await this.sql`
      SELECT
        intent.status AS purchase_intent_status,
        intent.display_id AS purchase_intent_display_id,
        item.product_name_snapshot AS product_name,
        item.quantity,
        intent.delivery_date::text,
        orders.display_id AS order_display_id,
        orders.status AS order_status,
        payment.status AS payment_status,
        fulfillment.status AS fulfillment_status,
        item.catalog_product_id,
        orders.total_minor,
        orders.currency,
        shipment.carrier_code,
        shipment.tracking_reference
      FROM bloombox.purchase_intents AS intent
      JOIN bloombox.purchase_intent_items AS item
        ON item.purchase_intent_id = intent.id AND item.position = 0
      LEFT JOIN bloombox.orders AS orders ON orders.purchase_intent_id = intent.id
      LEFT JOIN LATERAL (
        SELECT status
        FROM bloombox.payments
        WHERE order_id = orders.id
        ORDER BY updated_at DESC
        LIMIT 1
      ) AS payment ON TRUE
      LEFT JOIN LATERAL (
        SELECT id, status
        FROM bloombox.fulfillments
        WHERE order_id = orders.id
        ORDER BY updated_at DESC
        LIMIT 1
      ) AS fulfillment ON TRUE
      LEFT JOIN LATERAL (
        SELECT carrier_code, tracking_reference
        FROM bloombox.shipments
        WHERE fulfillment_id = fulfillment.id
        ORDER BY updated_at DESC
        LIMIT 1
      ) AS shipment ON TRUE
      WHERE intent.commerce_provider = 'STRIPE'
        AND intent.external_checkout_id = ${reference}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const parsed = rowSchema.safeParse(rows[0]);
    if (!parsed.success) throw new InvalidOrderStatusProjectionError();
    const row = parsed.data;
    const total = row.total_minor === null ? undefined : toSafeInteger(row.total_minor);
    if ((total === undefined) !== (row.currency === null)) throw new InvalidOrderStatusProjectionError();
    return {
      purchaseIntentStatus: row.purchase_intent_status,
      purchaseIntentDisplayId: row.purchase_intent_display_id,
      productId: row.catalog_product_id,
      productName: row.product_name,
      quantity: row.quantity,
      deliveryDate: row.delivery_date,
      orderDisplayId: row.order_display_id ?? undefined,
      orderStatus: row.order_status ?? undefined,
      paymentStatus: row.payment_status ?? undefined,
      fulfillmentStatus: row.fulfillment_status ?? undefined,
      total: total === undefined ? undefined : money(total),
      carrierCode: row.carrier_code ?? undefined,
      trackingReference: row.tracking_reference ?? undefined,
    };
  }
}

function toSafeInteger(value: number | string | bigint): number {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new InvalidOrderStatusProjectionError();
  }
  return normalized;
}
