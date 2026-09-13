import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { StockAvailabilityReader } from "../application/inventory-reservations";
import { InventoryUnavailableError } from "../domain/reservation";
export class PostgresStockAvailabilityReader implements StockAvailabilityReader {
  constructor(private readonly sql: DatabaseClient) {}
  async availableProductIds(productIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (!productIds.length) return new Set();
    try {
      const rows = await this.sql`SELECT 'native_' || product_id::text AS id FROM bloombox.inventory_stock
        WHERE 'native_' || product_id::text = ANY (${this.sql.array([...productIds])}::text[])
          AND on_hand > reserved`;
      return new Set(rows.map((row) => String(row.id)));
    } catch { throw new InventoryUnavailableError(); }
  }
}
