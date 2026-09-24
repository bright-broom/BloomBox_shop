import {
  OrderDeliveryDateChangeError,
  planOrderDeliveryDateChange,
  type OrderDeliveryDateCommand,
  type OrderDeliveryDateFacts,
  type OrderDeliveryDatePlan,
  type OrderDeliveryDateWindow,
} from "../domain/order-delivery-date-change";

export type OrderDeliveryDateActor = Readonly<{ operatorId: string }>;
export type OrderDeliveryDateChangeRecord = Readonly<{ orderId: string; previousDate: string; nextDate: string; reason: string; occurredAt: string }>;
export type OrderDeliveryDateReceipt = Readonly<{ orderId: string; deliveryDate: string; replayed: boolean }>;

export interface OrderDeliveryDateStore {
  /** Locks the gift snapshot and reads the facts the decision needs; null when no such native order exists. */
  lockFacts(orderId: string): Promise<OrderDeliveryDateFacts | null>;
  findChange(operatorId: string, requestId: string): Promise<OrderDeliveryDateChangeRecord | null>;
  apply(plan: OrderDeliveryDatePlan, command: OrderDeliveryDateCommand, operatorId: string): Promise<void>;
}

/**
 * Applies one operator-approved delivery date change. A resubmitted request returns the first result instead of
 * moving the date again, so a lost response or a double click cannot reschedule an order twice.
 */
export class ChangeOrderDeliveryDate {
  constructor(private readonly store: OrderDeliveryDateStore) {}

  async execute(
    command: OrderDeliveryDateCommand,
    window: OrderDeliveryDateWindow,
    actor: OrderDeliveryDateActor,
  ): Promise<OrderDeliveryDateReceipt> {
    const previous = await this.store.findChange(actor.operatorId, command.requestId);
    if (previous) {
      if (previous.orderId !== command.orderId || previous.previousDate !== command.expectedDate
        || previous.nextDate !== command.nextDate || previous.reason !== command.reason.trim()) {
        throw new OrderDeliveryDateChangeError("CONFLICT");
      }
      return { orderId: previous.orderId, deliveryDate: previous.nextDate, replayed: true };
    }
    const facts = await this.store.lockFacts(command.orderId);
    if (!facts) throw new OrderDeliveryDateChangeError("NOT_FOUND");
    const plan = planOrderDeliveryDateChange(facts, command, window);
    await this.store.apply(plan, command, actor.operatorId);
    return { orderId: command.orderId, deliveryDate: plan.nextDate, replayed: false };
  }
}
