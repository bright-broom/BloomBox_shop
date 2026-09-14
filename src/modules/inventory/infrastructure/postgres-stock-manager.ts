import { z } from "zod";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import { MAX_STOCK_QUANTITY, StockManagementError, type StockManager, type StockChange } from "../application/manage-stock";
export const stockChangeSchema = z.object({ productId: z.uuid(), expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  requestId: z.uuid(), delta: z.number().int().min(-MAX_STOCK_QUANTITY).max(MAX_STOCK_QUANTITY).refine((n) => n !== 0),
  reason: z.enum(["RECEIVED", "CORRECTION"]),
}).strict().refine((p) => p.reason !== "RECEIVED" || p.delta > 0);
export class PostgresStockManager implements StockManager {
  constructor(private readonly tx: DatabaseTransaction) {}
  async read(ids: readonly string[]) {
    if (!ids.length) return [];
    const rows = await this.tx`SELECT product_id, on_hand, reserved, version FROM bloombox.inventory_stock WHERE product_id = ANY(${this.tx.array([...ids])}::uuid[])`;
    return rows.map((r) => ({ productId: String(r.product_id), onHand: Number(r.on_hand), reserved: Number(r.reserved), version: Number(r.version) }));
  }
  async change(input: StockChange, operatorId: string) {
    const parsed = stockChangeSchema.safeParse(input);
    if (!parsed.success) throw new StockManagementError("INVALID");
    const p = parsed.data;
    await this.tx`SELECT pg_advisory_xact_lock(hashtextextended(${"stock:" + p.productId}, 0))`;
    const [prior] = await this.tx`SELECT command = ${this.tx.json(p)} AS matches FROM bloombox.inventory_adjustments
      WHERE operator_id = ${operatorId} AND request_id = ${p.requestId}`;
    if (prior) { if (!prior.matches) throw new StockManagementError("CONFLICT"); return; }
    const [product] = await this.tx`SELECT id FROM bloombox.catalog_products WHERE id = ${p.productId}`;
    if (!product) throw new StockManagementError("INVALID");
    const [current] = await this.tx`SELECT on_hand, reserved, version FROM bloombox.inventory_stock WHERE product_id = ${p.productId} FOR UPDATE`;
    if (Number(current?.version ?? 0) !== p.expectedVersion) throw new StockManagementError("CONFLICT");
    const before = Number(current?.on_hand ?? 0);
    const after = before + p.delta;
    if (after < Number(current?.reserved ?? 0) || after > MAX_STOCK_QUANTITY) throw new StockManagementError("INVALID");
    if (!current) {
      await this.tx`INSERT INTO bloombox.inventory_stock (product_id, on_hand) VALUES (${p.productId}, ${after})`;
    } else {
      await this.tx`UPDATE bloombox.inventory_stock SET on_hand=${after}, version=version+1 WHERE product_id=${p.productId}`;
    }
    await this.tx`INSERT INTO bloombox.inventory_adjustments (operator_id, request_id, product_id, previous_version, version,
      before_quantity, after_quantity, delta, reason, command)
      VALUES (${operatorId}, ${p.requestId}, ${p.productId}, ${p.expectedVersion}, ${p.expectedVersion + 1}, ${before}, ${after}, ${p.delta}, ${p.reason}, ${this.tx.json(p)})`;
  }
}
