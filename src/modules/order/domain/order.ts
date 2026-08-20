import type { Money } from "@/shared/domain/money";
import type { GiftMessage, RecipientName } from "./order-policy";
import { assertOrderTransition, type OrderStatus } from "./order-status";

export type OrderId = string & { readonly __brand: "OrderId" };
export type CatalogProductReference = string & { readonly __brand: "CatalogProductReference" };

export function catalogProductReference(value: string): CatalogProductReference {
  if (!value.trim()) throw new InvalidCatalogProductReferenceError();
  return value as CatalogProductReference;
}

export class InvalidCatalogProductReferenceError extends Error {
  constructor() {
    super("Catalog product reference must not be empty");
    this.name = "InvalidCatalogProductReferenceError";
  }
}

export type OrderItem = Readonly<{
  productId: CatalogProductReference;
  productName: string;
  quantity: number;
  unitPriceSnapshot: Money;
  subtotal: Money;
}>;

export type Recipient = Readonly<{
  name: RecipientName;
  deliveryDate: string;
}>;

export class Order {
  private currentStatus: OrderStatus;

  private constructor(
    readonly id: OrderId,
    readonly displayId: string,
    readonly item: OrderItem,
    readonly recipient: Recipient,
    readonly giftMessage: GiftMessage,
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
    giftMessage: GiftMessage;
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
