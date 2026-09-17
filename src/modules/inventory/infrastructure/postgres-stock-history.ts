import { z } from "zod";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import { StockManagementError } from "../application/manage-stock";
import { STOCK_HISTORY_PAGE_SIZE, type StockHistoryPage } from "../application/stock-history";
const rowSchema = z.object({ operator_id: z.uuid(), request_id: z.uuid(), occurred_at: z.date(),
  version: z.coerce.number().int().positive().safe(), before_quantity: z.number().int().nonnegative(),
  after_quantity: z.number().int().nonnegative(), delta: z.number().int(), reason: z.enum(["RECEIVED", "CORRECTION"]) });
export class PostgresStockHistory {
  constructor(private readonly tx: DatabaseTransaction) {}
  async read(productId: string, before?: number): Promise<StockHistoryPage> {
    if (!z.object({ productId: z.uuid(), before: z.number().int().positive().safe().optional() }).safeParse({ productId, before }).success) throw new StockManagementError("INVALID");
    const rows = await this.tx`SELECT operator_id, request_id, occurred_at, version, before_quantity, after_quantity, delta, reason
      FROM bloombox.inventory_adjustments WHERE product_id = ${productId}
      AND (${before ?? null}::bigint IS NULL OR version < ${before ?? null}) ORDER BY version DESC LIMIT ${STOCK_HISTORY_PAGE_SIZE + 1}`;
    const entries = rows.slice(0, STOCK_HISTORY_PAGE_SIZE).map((row) => {
      const value = rowSchema.parse(row);
      return { operatorId: value.operator_id, requestId: value.request_id, occurredAt: value.occurred_at.toISOString(), version: value.version,
        beforeQuantity: value.before_quantity, afterQuantity: value.after_quantity, delta: value.delta, reason: value.reason };
    });
    return { entries, next: rows.length > STOCK_HISTORY_PAGE_SIZE ? entries.at(-1)!.version : null };
  }
}
