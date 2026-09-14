import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import type { InventoryReservations, InventoryReleaseReason } from "../application/inventory-reservations";
import { InventoryUnavailableError, InsufficientInventoryError, reservationTransition } from "../domain/reservation";

const purchaseSchema = z.object({
  id: z.uuid(), status: z.string(), commerce_provider: z.enum(["STRIPE", "SHOPIFY"]).nullable(),
  catalog_product_id: z.string(), quantity: z.number().int().positive(), expires_at: z.date(),
});
const reservationSchema = z.object({ product_id: z.uuid(), quantity: z.number().int().positive(), status: z.enum(["HELD", "COMMITTED", "RELEASED"]) });

export class PostgresInventoryReservations implements InventoryReservations {
  constructor(private readonly tx: DatabaseTransaction) {}
  async reserve(id: string): Promise<void> {
    await this.run(async () => {
      const purchase = await this.purchase(id);
      if (!purchase.catalog_product_id.startsWith("native_")) return;
      const productId = z.uuid().parse(purchase.catalog_product_id.slice(7));
      if (purchase.status !== "READY_FOR_CHECKOUT" || purchase.commerce_provider !== null) throw new InventoryUnavailableError();
      const prior = await this.tx`SELECT product_id, quantity, status FROM bloombox.inventory_reservations WHERE purchase_intent_id = ${id} FOR UPDATE`;
      if (prior.length) {
        const row = reservationSchema.parse(prior[0]);
        if (row.product_id !== productId || row.quantity !== purchase.quantity || row.status !== "HELD") throw new InventoryUnavailableError();
        return;
      }
      const product = await this.tx`SELECT id FROM bloombox.catalog_products
        WHERE id = ${productId} AND status = 'PUBLISHED' AND available = true`;
      if (!product.length) throw new InsufficientInventoryError();
      const stock = await this.tx`UPDATE bloombox.inventory_stock SET reserved = reserved + ${purchase.quantity}, version = version + 1
        WHERE product_id = ${productId} AND on_hand - reserved >= ${purchase.quantity} RETURNING product_id`;
      if (!stock.length) throw new InsufficientInventoryError();
      await this.tx`INSERT INTO bloombox.inventory_reservations (purchase_intent_id, product_id, quantity, status)
        VALUES (${id}, ${productId}, ${purchase.quantity}, 'HELD')`;
      await this.movement(id, purchase.quantity, "RESERVED", "PURCHASE_CREATED", new Date());
    });
  }
  async commit(id: string, occurredAt: Date): Promise<void> {
    await this.finish(id, "COMMITTED", "PAYMENT_CONFIRMED", occurredAt);
  }
  async release(id: string, reason: InventoryReleaseReason, occurredAt: Date): Promise<void> {
    await this.finish(id, "RELEASED", reason, occurredAt);
  }
  private async finish(id: string, target: "COMMITTED" | "RELEASED", reason: string, occurredAt: Date) {
    await this.run(async () => {
      if (!Number.isFinite(occurredAt.getTime())) throw new InventoryUnavailableError();
      const purchase = await this.purchase(id);
      if (!purchase.catalog_product_id.startsWith("native_")) return;
      const rows = await this.tx`SELECT product_id, quantity, status FROM bloombox.inventory_reservations WHERE purchase_intent_id = ${id} FOR UPDATE`;
      const row = reservationSchema.parse(rows[0]);
      if (`native_${row.product_id}` !== purchase.catalog_product_id || row.quantity !== purchase.quantity) throw new InventoryUnavailableError();
      if (!reservationTransition(row.status, target)) return;
      const beforeProvider = reason === "BEFORE_CHECKOUT_CANCELLED" || reason === "INTENT_EXPIRED";
      if (beforeProvider) {
        if (purchase.commerce_provider !== null || !["DRAFT", "READY_FOR_CHECKOUT"].includes(purchase.status)
          || (reason === "INTENT_EXPIRED" && purchase.expires_at > occurredAt)) throw new InventoryUnavailableError();
      } else if (purchase.commerce_provider !== "STRIPE" || !(
        purchase.status === "CHECKOUT_CREATED"
        // Stripe was selected but the creation response was lost, so the purchase stays READY_FOR_CHECKOUT without a
        // session ID. Only its verified provider expiry may release it (ADR 0010); payment facts still need a session.
        || (purchase.status === "READY_FOR_CHECKOUT" && reason === "CHECKOUT_EXPIRED")
      )) throw new InventoryUnavailableError();
      const updated = target === "COMMITTED" ? await this.tx`UPDATE bloombox.inventory_stock
        SET reserved = reserved - ${row.quantity}, on_hand = on_hand - ${row.quantity}, version = version + 1
        WHERE product_id = ${row.product_id} AND reserved >= ${row.quantity} RETURNING product_id`
        : await this.tx`UPDATE bloombox.inventory_stock SET reserved = reserved - ${row.quantity}, version = version + 1
          WHERE product_id = ${row.product_id} AND reserved >= ${row.quantity} RETURNING product_id`;
      if (updated.length !== 1) throw new InventoryUnavailableError();
      await this.tx`UPDATE bloombox.inventory_reservations SET status = ${target}, updated_at = ${occurredAt} WHERE purchase_intent_id = ${id}`;
      await this.movement(id, row.quantity, target, reason, occurredAt);
    });
  }
  private async purchase(id: string) {
    z.uuid().parse(id);
    const rows = await this.tx`SELECT intent.id, intent.status, intent.commerce_provider, intent.expires_at, item.catalog_product_id, item.quantity
      FROM bloombox.purchase_intents intent JOIN bloombox.purchase_intent_items item ON item.purchase_intent_id = intent.id AND item.position = 0
      WHERE intent.id = ${id} FOR UPDATE OF intent`;
    return purchaseSchema.parse(rows[0]);
  }
  private async movement(id: string, quantity: number, kind: string, reason: string, occurredAt: Date) {
    await this.tx`INSERT INTO bloombox.inventory_movements (id, purchase_intent_id, quantity, kind, reason, occurred_at)
      VALUES (${randomUUID()}, ${id}, ${quantity}, ${kind}, ${reason}, ${occurredAt})`;
  }
  private async run(work: () => Promise<void>) {
    try { await work(); } catch (error) {
      if (error instanceof InsufficientInventoryError) throw error;
      throw new InventoryUnavailableError();
    }
  }
}
