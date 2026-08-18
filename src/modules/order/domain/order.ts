import type { ProductId } from "@/modules/catalog/domain/product";
import type { Money } from "@/shared/domain/money";
import { assertOrderTransition, type OrderStatus } from "./order-status";

export type OrderId = string & { readonly __brand: "OrderId" };

export type OrderItem = Readonly<{
  productId: ProductId;
  productName: string;
  quantity: number;
  unitPriceSnapshot: Money;
  subtotal: Money;
}>;

export type Recipient = Readonly<{
  name: string;
  deliveryDate: string;
}>;

export class Order {
  private currentStatus: OrderStatus;

  private constructor(
    readonly id: OrderId,
    readonly displayId: string,
    readonly item: OrderItem,
    readonly recipient: Recipient,
    readonly giftMessage: string,
    readonly createdAt: Date,
    status: OrderStatus,
  ) {
    this.currentStatus = status;
  }

  static create(input: {
    id: OrderId;
    displayId: string;
    item: OrderItem;
    recipient: Recipient;
    giftMessage: string;
    createdAt: Date;
  }): Order {
    return new Order(
      input.id,
      input.displayId,
      input.item,
      input.recipient,
      input.giftMessage,
      input.createdAt,
      "DRAFT",
    );
  }

  get status(): OrderStatus {
    return this.currentStatus;
  }

  transitionTo(nextStatus: OrderStatus): void {
    assertOrderTransition(this.currentStatus, nextStatus);
    this.currentStatus = nextStatus;
  }
}
