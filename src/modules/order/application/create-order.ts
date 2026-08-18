import type { ProductRepository } from "@/modules/catalog/domain/product-repository";
import { productId } from "@/modules/catalog/domain/product";
import { multiplyMoney } from "@/shared/domain/money";
import { Order, type OrderId } from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";

export class ProductUnavailableError extends Error {
  constructor() {
    super("選択された花は現在ご注文いただけません。");
    this.name = "ProductUnavailableError";
  }
}

export type CreateOrderInput = Readonly<{
  productId: string;
  recipientName: string;
  deliveryDate: string;
  giftMessage: string;
}>;

export class CreateOrder {
  constructor(
    private readonly products: ProductRepository,
    private readonly orders: OrderRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async execute(input: CreateOrderInput): Promise<Order> {
    const product = await this.products.findById(productId(input.productId));
    if (!product?.available) {
      throw new ProductUnavailableError();
    }

    const createdAt = this.now();
    const rawId = this.createId();
    const order = Order.create({
      id: rawId as OrderId,
      displayId: createDisplayId(createdAt, rawId),
      item: {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPriceSnapshot: product.price,
        subtotal: multiplyMoney(product.price, 1),
      },
      recipient: {
        name: input.recipientName,
        deliveryDate: input.deliveryDate,
      },
      giftMessage: input.giftMessage,
      createdAt,
    });

    order.transitionTo("PENDING_PAYMENT");
    await this.orders.save(order);
    return order;
  }
}

function createDisplayId(createdAt: Date, id: string): string {
  const date = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(createdAt)
    .replaceAll("/", "");
  return `BB-${date}-${id.slice(0, 4).toUpperCase()}`;
}
