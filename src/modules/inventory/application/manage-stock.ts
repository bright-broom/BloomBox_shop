export const MAX_STOCK_QUANTITY = 1_000_000;
export type StockChange = Readonly<{ productId: string; expectedVersion: number; requestId: string; delta: number; reason: "RECEIVED" | "CORRECTION" }>;
export type StockSnapshot = Readonly<{ productId: string; onHand: number; reserved: number; version: number }>;
export class StockManagementError extends Error {
  constructor(readonly code: "INVALID" | "CONFLICT") { super(code); this.name = "StockManagementError"; }
}
export interface StockManager {
  read(productIds: readonly string[]): Promise<readonly StockSnapshot[]>;
  change(command: StockChange, operatorId: string): Promise<void>;
}
