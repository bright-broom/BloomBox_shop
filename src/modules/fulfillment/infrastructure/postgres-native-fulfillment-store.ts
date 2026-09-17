import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import { DataProtectionError, type AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { FULFILLMENT_STATUSES } from "../domain/fulfillment-status";
import { NATIVE_CARRIER_CODES, NATIVE_FULFILLMENT_ACTIONS, NativeFulfillmentError } from "../domain/native-fulfillment";
import { nativeFulfillmentCommandSchema } from "./native-fulfillment-schema";
import {
  NATIVE_FULFILLMENT_HISTORY_LIMIT, NATIVE_FULFILLMENT_PAGE_SIZE,
  type NativeFulfillmentActor, type NativeFulfillmentChange, type NativeFulfillmentDestination,
  type NativeFulfillmentListQuery, type NativeFulfillmentStore, type NativeFulfillmentSummary,
} from "../application/manage-native-fulfillment";

const version = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const status = z.enum(FULFILLMENT_STATUSES);
const orderStatus = z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"]);
const date = z.iso.date();
const cursorSchema = z.object({ deliveryDate: date, fulfillmentId: z.uuid() }).strict();
const shipmentSchema = z.object({
  carrier_code: z.enum(NATIVE_CARRIER_CODES), tracking_reference: z.string().regex(/^[A-Z0-9]{8,32}$/),
  shipped_at: z.date(), delivered_at: z.date().nullable(),
});
const summarySchema = z.object({
  id: z.uuid(), version, status, order_id: z.uuid(), display_id: z.string().min(1),
  ordered_at: z.date(), delivery_date: date, order_status: orderStatus,
  payment_statuses: z.array(z.string()), items: z.array(z.object({ name: z.string(), quantity: z.number().int().positive() })),
});
const addressSchema = z.object({ collectedInformation: z.object({ shipping_details: z.object({
  name: z.string().trim().min(1).max(200),
  address: z.object({ country: z.literal("JP"), postal_code: z.string().trim().min(1).max(32),
    state: z.string().trim().min(1).max(200), city: z.string().trim().min(1).max(200),
    line1: z.string().trim().min(1).max(200), line2: z.string().max(200).nullable().optional(),
  }),
}) }) });

/** Bound to an authorized transaction. No buyer contact or gift message column is selected. */
export class PostgresNativeFulfillmentStore implements NativeFulfillmentStore {
  constructor(
    private readonly tx: DatabaseTransaction,
    private readonly protector: Pick<AesGcmDataProtector, "unprotect">,
  ) {}

  async list(query: NativeFulfillmentListQuery): ReturnType<NativeFulfillmentStore["list"]> {
    const after = query.after === null ? null : decodeCursor(query.after);
    if (query.status !== null && !status.safeParse(query.status).success) throw new NativeFulfillmentError("INVALID");
    const rows = await this.tx`
      SELECT f.id, f.version, f.status, f.order_id, o.display_id, o.status AS order_status,
        o.created_at AS ordered_at, g.delivery_date::text AS delivery_date,
        s.carrier_code, s.tracking_reference, s.shipped_at, s.delivered_at,
        ARRAY(SELECT DISTINCT p.status FROM bloombox.payments p WHERE p.order_id = o.id ORDER BY p.status) AS payment_statuses,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', i.product_name_snapshot, 'quantity', i.quantity) ORDER BY i.position), '[]'::jsonb)
          FROM bloombox.order_items i WHERE i.order_id = o.id) AS items
      FROM bloombox.fulfillments f JOIN bloombox.orders o ON o.id = f.order_id
      JOIN bloombox.order_gift_snapshots g ON g.order_id = o.id
      LEFT JOIN bloombox.shipments s ON s.fulfillment_id = f.id
      WHERE o.commerce_provider = 'STRIPE' AND (${query.status === null} OR f.status = ${query.status})
        AND (${after === null} OR (g.delivery_date, f.id) > (${after?.deliveryDate ?? null}::date, ${after?.fulfillmentId ?? null}::uuid))
      ORDER BY g.delivery_date, f.id LIMIT ${NATIVE_FULFILLMENT_PAGE_SIZE + 1}
    `;
    const items = rows.slice(0, NATIVE_FULFILLMENT_PAGE_SIZE).map((row) => this.summary(row));
    const last = items.at(-1);
    return { items, next: rows.length > NATIVE_FULFILLMENT_PAGE_SIZE && last
      ? Buffer.from(JSON.stringify({ deliveryDate: last.deliveryDate, fulfillmentId: last.fulfillmentId })).toString("base64url") : null };
  }

  async read(fulfillmentId: string, actor: NativeFulfillmentActor): ReturnType<NativeFulfillmentStore["read"]> {
    if (!z.uuid().safeParse(fulfillmentId).success) throw new NativeFulfillmentError("INVALID");
    const [row] = await this.tx`
      SELECT f.id, f.version, f.status, f.order_id, o.display_id, o.status AS order_status,
        o.created_at AS ordered_at, g.delivery_date::text AS delivery_date,
        s.carrier_code, s.tracking_reference, s.shipped_at, s.delivered_at,
        ARRAY(SELECT DISTINCT p.status FROM bloombox.payments p WHERE p.order_id = o.id ORDER BY p.status) AS payment_statuses,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', i.product_name_snapshot, 'quantity', i.quantity) ORDER BY i.position), '[]'::jsonb)
          FROM bloombox.order_items i WHERE i.order_id = o.id) AS items,
        g.pii_key_id, g.address_ciphertext
      FROM bloombox.fulfillments f JOIN bloombox.orders o ON o.id = f.order_id
      JOIN bloombox.order_gift_snapshots g ON g.order_id = o.id
      LEFT JOIN bloombox.shipments s ON s.fulfillment_id = f.id
      WHERE f.id = ${fulfillmentId}::uuid AND o.commerce_provider = 'STRIPE'
    `;
    if (!row) return null;
    // A failure to append audit aborts the transaction; PII is never returned without its access record.
    await this.tx`INSERT INTO bloombox.native_fulfillment_accesses (id, operator_id, fulfillment_id)
      VALUES (${randomUUID()}, ${actor.operatorId}::uuid, ${fulfillmentId}::uuid)`;
    const summary = this.summary(row);
    const historyRows = await this.tx`
      SELECT action, from_status, to_status, version, operator_id,
        command ->> 'reason' AS reason, occurred_at
      FROM bloombox.native_fulfillment_changes WHERE fulfillment_id = ${fulfillmentId}::uuid
      ORDER BY version DESC LIMIT ${NATIVE_FULFILLMENT_HISTORY_LIMIT}
    `;
    const history = historyRows.map((entry) => {
      const value = z.object({ action: z.enum(NATIVE_FULFILLMENT_ACTIONS), from_status: status, to_status: status,
        version, operator_id: z.uuid(), reason: z.string().nullable(), occurred_at: z.date(),
      }).parse(entry);
      return { action: value.action, fromStatus: value.from_status, toStatus: value.to_status, version: value.version,
        operatorId: value.operator_id, reason: value.reason, occurredAt: value.occurred_at.toISOString() };
    });
    return { ...summary, destination: this.destination(row, summary.orderId), history };
  }

  async lockFacts(fulfillmentId: string): ReturnType<NativeFulfillmentStore["lockFacts"]> {
    if (!z.uuid().safeParse(fulfillmentId).success) throw new NativeFulfillmentError("INVALID");
    const [row] = await this.tx`
      SELECT f.id, f.order_id, f.status, f.version FROM bloombox.fulfillments f
      JOIN bloombox.orders o ON o.id = f.order_id
      WHERE f.id = ${fulfillmentId}::uuid AND o.commerce_provider = 'STRIPE' FOR UPDATE OF f
    `;
    if (!row) return null;
    const fulfillment = z.object({ id: z.uuid(), order_id: z.uuid(), status, version }).parse(row);
    const [order] = await this.tx`SELECT status FROM bloombox.orders WHERE id = ${fulfillment.order_id}::uuid FOR SHARE`;
    const payments = await this.tx`SELECT status FROM bloombox.payments WHERE order_id = ${fulfillment.order_id}::uuid ORDER BY id FOR SHARE`;
    const [quantity] = await this.tx`SELECT COALESCE(SUM(quantity), 0)::text AS quantity FROM bloombox.order_items WHERE order_id = ${fulfillment.order_id}::uuid`;
    const shipments = await this.tx`SELECT id FROM bloombox.shipments WHERE fulfillment_id = ${fulfillment.id}::uuid`;
    return { fulfillmentId: fulfillment.id, status: fulfillment.status, version: fulfillment.version,
      orderStatus: orderStatus.parse(order.status), paymentStatuses: [...new Set(payments.map((payment) => z.string().parse(payment.status)))],
      itemQuantity: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(quantity.quantity), hasShipment: shipments.length !== 0 };
  }

  async findChange(operatorId: string, requestId: string): ReturnType<NativeFulfillmentStore["findChange"]> {
    const [row] = await this.tx`SELECT command, to_status, version FROM bloombox.native_fulfillment_changes
      WHERE operator_id = ${operatorId}::uuid AND request_id = ${requestId}::uuid`;
    if (!row) return null;
    return { command: nativeFulfillmentCommandSchema.parse(row.command), status: status.parse(row.to_status), version: version.parse(row.version) };
  }

  async record(change: NativeFulfillmentChange, actor: NativeFulfillmentActor): ReturnType<NativeFulfillmentStore["record"]> {
    const { command, shipment } = change;
    const [updated] = await this.tx`
      UPDATE bloombox.fulfillments SET status = ${change.toStatus}, version = version + 1, updated_at = clock_timestamp()
      WHERE id = ${command.fulfillmentId}::uuid AND version = ${command.expectedVersion} AND status = ${change.fromStatus}
      RETURNING version
    `;
    if (!updated) throw new NativeFulfillmentError("CONFLICT");
    if (shipment.kind === "CREATE") {
      await this.tx`INSERT INTO bloombox.shipments (id, fulfillment_id, carrier_code, tracking_reference, shipped_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${command.fulfillmentId}::uuid, ${shipment.carrier}, ${shipment.trackingNumber}, clock_timestamp(), clock_timestamp(), clock_timestamp())`;
    } else if (shipment.kind === "CORRECT") {
      const changed = await this.tx`UPDATE bloombox.shipments SET carrier_code = ${shipment.carrier}, tracking_reference = ${shipment.trackingNumber}, updated_at = clock_timestamp()
        WHERE fulfillment_id = ${command.fulfillmentId}::uuid RETURNING id`;
      if (changed.length !== 1) throw new NativeFulfillmentError("CONFLICT");
    } else if (shipment.kind === "MARK_DELIVERED") {
      const changed = await this.tx`UPDATE bloombox.shipments SET delivered_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE fulfillment_id = ${command.fulfillmentId}::uuid RETURNING id`;
      if (changed.length !== 1) throw new NativeFulfillmentError("CONFLICT");
    }
    await this.tx`INSERT INTO bloombox.native_fulfillment_changes
      (operator_id, request_id, fulfillment_id, action, from_status, to_status, previous_version, version, command)
      VALUES (${actor.operatorId}::uuid, ${command.requestId}::uuid, ${command.fulfillmentId}::uuid, ${command.action},
        ${change.fromStatus}, ${change.toStatus}, ${command.expectedVersion}, ${command.expectedVersion + 1}, ${this.tx.json(command)})`;
    if (change.fromStatus !== change.toStatus) {
      await this.tx`INSERT INTO bloombox.fulfillment_status_transitions
        (id, fulfillment_id, from_status, to_status, reason_code, idempotency_key, occurred_at)
        VALUES (${randomUUID()}, ${command.fulfillmentId}::uuid, ${change.fromStatus}, ${change.toStatus},
          ${command.action}, ${command.requestId}, clock_timestamp())`;
    }
    return { fulfillmentId: command.fulfillmentId, status: change.toStatus, version: version.parse(updated.version) };
  }

  private summary(row: unknown): NativeFulfillmentSummary {
    const value = summarySchema.parse(row);
    const parsed = shipmentSchema.safeParse(row);
    const shipment = parsed?.success ? parsed.data : null;
    return { fulfillmentId: value.id, version: value.version, status: value.status, orderId: value.order_id,
      orderDisplayId: value.display_id, orderedAt: value.ordered_at.toISOString(), deliveryDate: value.delivery_date,
      orderStatus: value.order_status, paymentStatus: value.payment_statuses.length === 1 ? value.payment_statuses[0] : "UNKNOWN",
      items: value.items, shipment: shipment ? { carrier: shipment.carrier_code, trackingNumber: shipment.tracking_reference,
        shippedAt: shipment.shipped_at.toISOString(), deliveredAt: shipment.delivered_at?.toISOString() ?? null } : null };
  }

  private destination(row: Record<string, unknown>, orderId: string): NativeFulfillmentDestination | null {
    const protectedRow = z.object({ pii_key_id: z.string(), address_ciphertext: z.instanceof(Buffer) }).safeParse(row);
    if (!protectedRow.success) return null;
    // Expected ciphertext/schema failures suppress the address. There is deliberately no billing-address fallback.
    try {
      const raw: unknown = JSON.parse(this.protector.unprotect({ keyId: protectedRow.data.pii_key_id,
        ciphertext: protectedRow.data.address_ciphertext }, `order:${orderId}:address:v1`));
      const parsed = addressSchema.safeParse(raw);
      if (!parsed.success) return null;
      const { name, address } = parsed.data.collectedInformation.shipping_details;
      return { name, postalCode: address.postal_code, prefecture: address.state, city: address.city,
        line1: address.line1, line2: address.line2 ?? null };
    } catch (error) {
      if (!(error instanceof DataProtectionError) && !(error instanceof SyntaxError)) throw error;
      return null;
    }
  }
}

function decodeCursor(input: string) {
  try {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(input)) throw new Error("Invalid cursor");
    const raw: unknown = JSON.parse(Buffer.from(input, "base64url").toString("utf8"));
    return cursorSchema.parse(raw);
  } catch {
    throw new NativeFulfillmentError("INVALID");
  }
}
