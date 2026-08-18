import type { OrderId } from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";

export class GetOrder {
  constructor(private readonly orders: OrderRepository) {}

  execute(id: string) {
    return this.orders.findById(id as OrderId);
  }
}
