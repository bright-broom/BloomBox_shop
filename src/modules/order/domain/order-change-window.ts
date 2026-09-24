/**
 * How long a buyer can still ask to cancel or change an order, from the published terms:
 * up to the end of the day four days before the requested delivery date (Asia/Tokyo).
 * Whether a change is then carried out is an operator decision; this only states the window.
 */
export const ORDER_CHANGE_DEADLINE_DAYS = 4;
const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export class InvalidOrderChangeWindowError extends Error {
  constructor() {
    super("Order change window input is invalid");
    this.name = "InvalidOrderChangeWindowError";
  }
}

export type OrderChangeWindow = Readonly<{
  /** The last day (YYYY-MM-DD, Asia/Tokyo) on which a request still arrives in time. */
  lastDay: string;
  open: boolean;
}>;

/** The instant the window closes: midnight in Tokyo at the start of the day after the last day. */
function closesAt(deliveryDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) throw new InvalidOrderChangeWindowError();
  const delivery = Date.parse(`${deliveryDate}T00:00:00+09:00`);
  if (!Number.isSafeInteger(delivery)) throw new InvalidOrderChangeWindowError();
  return delivery - (ORDER_CHANGE_DEADLINE_DAYS - 1) * DAY_MS;
}

export function orderChangeWindow(deliveryDate: string, now: Date): OrderChangeWindow {
  const closes = closesAt(deliveryDate);
  if (!Number.isSafeInteger(now.getTime())) throw new InvalidOrderChangeWindowError();
  const lastDay = new Date(closes - DAY_MS + JST_OFFSET_MS).toISOString().slice(0, 10);
  return { lastDay, open: now.getTime() < closes };
}

/** Fulfillment states where the gift has already left us, so no change can reach it any more. */
const DISPATCHED_FULFILLMENTS: readonly string[] = ["SHIPPED", "DELIVERED", "FULFILLED", "RETURNED"];

export function orderDispatched(fulfillment: string): boolean {
  return DISPATCHED_FULFILLMENTS.includes(fulfillment);
}
