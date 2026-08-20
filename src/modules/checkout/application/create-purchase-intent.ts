import { productId, type ProductRepository } from "@/modules/catalog/public";
import { assertAvailableDeliveryDate } from "@/modules/fulfillment/public";
import { multiplyMoney } from "@/shared/domain/money";
import { BUSINESS_TIME_ZONE } from "@/shared/domain/time";
import {
  catalogProductReference,
  PurchaseIntent,
  purchaseIntentId,
} from "../domain/purchase-intent";
import {
  giftMessage,
  recipientName,
} from "../domain/purchase-intent-policy";
import type { PurchaseIntentRepository } from "../domain/purchase-intent-repository";

export class ProductUnavailableError extends Error {
  constructor() {
    super("選択された花は現在ご注文いただけません。");
    this.name = "ProductUnavailableError";
  }
}

export type CreatePurchaseIntentInput = Readonly<{
  productId: string;
  recipientName: string;
  deliveryDate: string;
  giftMessage: string;
}>;

export class CreatePurchaseIntent {
  constructor(
    private readonly products: ProductRepository,
    private readonly intents: PurchaseIntentRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async execute(input: CreatePurchaseIntentInput): Promise<PurchaseIntent> {
    const product = await this.products.findById(productId(input.productId));
    if (!product?.available) {
      throw new ProductUnavailableError();
    }

    const createdAt = this.now();
    assertAvailableDeliveryDate(input.deliveryDate, createdAt);
    const rawId = this.createId();
    const intent = PurchaseIntent.create({
      id: purchaseIntentId(rawId),
      displayId: createDisplayId(createdAt, rawId),
      item: {
        productId: catalogProductReference(product.id),
        productName: product.name,
        quantity: 1,
        unitPriceSnapshot: product.price,
        subtotal: multiplyMoney(product.price, 1),
      },
      recipient: {
        name: recipientName(input.recipientName),
        deliveryDate: input.deliveryDate,
      },
      giftMessage: giftMessage(input.giftMessage),
      createdAt,
    });

    intent.transitionTo("READY_FOR_CHECKOUT");
    await this.intents.save(intent);
    return intent;
  }
}

function createDisplayId(createdAt: Date, id: string): string {
  const date = new Intl.DateTimeFormat("ja-JP", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(createdAt)
    .replaceAll("/", "");
  return `BBI-${date}-${id.slice(0, 4).toUpperCase()}`;
}
