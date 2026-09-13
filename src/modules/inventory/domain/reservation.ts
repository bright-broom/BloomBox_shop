export type ReservationStatus = "HELD" | "COMMITTED" | "RELEASED";
export class InventoryUnavailableError extends Error {
  constructor() { super("在庫を確認できませんでした。時間をおいてもう一度お試しください。"); this.name = "InventoryUnavailableError"; }
}
export class InsufficientInventoryError extends Error {
  constructor() { super("ご希望の数量の在庫を確保できませんでした。数量や商品を変更してください。"); this.name = "InsufficientInventoryError"; }
}
export function reservationTransition(current: ReservationStatus, target: "COMMITTED" | "RELEASED"): boolean {
  if (current === target) return false;
  if (current !== "HELD") throw new InventoryUnavailableError();
  return true;
}
