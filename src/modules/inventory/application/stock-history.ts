export const STOCK_HISTORY_PAGE_SIZE = 30;
export type StockHistoryEntry = Readonly<{
  operatorId: string; requestId: string; occurredAt: string; version: number;
  beforeQuantity: number; afterQuantity: number; delta: number; reason: "RECEIVED" | "CORRECTION";
}>;
export type StockHistoryPage = Readonly<{ entries: readonly StockHistoryEntry[]; next: number | null }>;
