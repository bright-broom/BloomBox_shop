/**
 * Operator-applied change of the requested delivery date. The published terms let a buyer ask to change or
 * cancel an order before it is dispatched; whether to accept a request is the operator's judgement, and these
 * rules only state what the system can still carry out safely. The buyer's own deadline lives in
 * `order-change-window`; an operator may accommodate a late request as long as the new date is still feasible.
 */
import { orderDispatched } from "./order-change-window";
import { orderPiiRetentionExpiry } from "./order-retention";

export const ORDER_DELIVERY_DATE_REASON_MAX_LENGTH = 200;
export const ORDER_DELIVERY_DATE_HISTORY_LIMIT = 20;

/** DENIED and UNAVAILABLE come from the operator connection, the rest from these rules. */
export const ORDER_DELIVERY_DATE_CHANGE_CODES = [
  "INVALID", "NOT_FOUND", "CONFLICT", "UNCHANGED", "OUT_OF_RANGE", "DISPATCHED", "ORDER_NOT_ACTIVE", "DENIED", "UNAVAILABLE",
] as const;
export type OrderDeliveryDateChangeCode = (typeof ORDER_DELIVERY_DATE_CHANGE_CODES)[number];

export class OrderDeliveryDateChangeError extends Error {
  constructor(readonly code: OrderDeliveryDateChangeCode) {
    super(`Order delivery date change rejected: ${code}`);
    this.name = "OrderDeliveryDateChangeError";
  }
}

export type OrderDeliveryDateFacts = Readonly<{
  orderStatus: string;
  deliveryDate: string;
  /** Every fulfillment of the order; a single dispatched one closes the change. */
  fulfillmentStatuses: readonly string[];
  hasShipment: boolean;
  /** The gift's personal data is gone once retention expires, so there is no address left to deliver to. */
  piiPurged: boolean;
  confirmedAt: Date | null;
}>;

export type OrderDeliveryDateCommand = Readonly<{
  orderId: string; requestId: string; expectedDate: string; nextDate: string; reason: string;
}>;
/** The orderable range at the moment of the change, from the same rules a buyer gets at checkout. */
export type OrderDeliveryDateWindow = Readonly<{ earliest: string; latest: string }>;
export type OrderDeliveryDateFormState = Readonly<{ status: "IDLE" | "SAVED" | OrderDeliveryDateChangeCode }>;
export type OrderDeliveryDatePlan = Readonly<{ previousDate: string; nextDate: string; retentionExpiresAt: Date; reason: string }>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO dates compare correctly as strings, which keeps the rule free of time-zone arithmetic. */
export function planOrderDeliveryDateChange(
  facts: OrderDeliveryDateFacts,
  command: OrderDeliveryDateCommand,
  window: OrderDeliveryDateWindow,
): OrderDeliveryDatePlan {
  const reason = command.reason.trim();
  if ([command.expectedDate, command.nextDate, facts.deliveryDate, window.earliest, window.latest].some((value) => !DATE.test(value))
    || reason.length === 0 || reason.length > ORDER_DELIVERY_DATE_REASON_MAX_LENGTH || window.latest < window.earliest) {
    throw new OrderDeliveryDateChangeError("INVALID");
  }
  if (command.expectedDate !== facts.deliveryDate) throw new OrderDeliveryDateChangeError("CONFLICT");
  if (facts.orderStatus !== "CONFIRMED" || !facts.confirmedAt || facts.piiPurged) throw new OrderDeliveryDateChangeError("ORDER_NOT_ACTIVE");
  if (facts.hasShipment || facts.fulfillmentStatuses.some(orderDispatched)) throw new OrderDeliveryDateChangeError("DISPATCHED");
  if (command.nextDate === facts.deliveryDate) throw new OrderDeliveryDateChangeError("UNCHANGED");
  if (command.nextDate < window.earliest || command.nextDate > window.latest) throw new OrderDeliveryDateChangeError("OUT_OF_RANGE");
  // The retention deadline follows the delivery date, so moving the date moves the deletion with it (P0-17).
  return { previousDate: facts.deliveryDate, nextDate: command.nextDate, reason,
    retentionExpiresAt: orderPiiRetentionExpiry(command.nextDate, facts.confirmedAt) };
}
