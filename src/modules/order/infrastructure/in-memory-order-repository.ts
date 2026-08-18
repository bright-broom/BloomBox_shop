import type { OrderRepository } from "../domain/order-repository";
import type { Order, OrderId } from "../domain/order";

const orders = new Map<OrderId, Order>();

export class InMemoryOrderRepository implements OrderRepository {
  async save(order: Order): Promise<void> {
    orders.set(order.id, order);
  }

  async findById(id: OrderId): Promise<Order | null> {
    return orders.get(id) ?? null;
  }
}
