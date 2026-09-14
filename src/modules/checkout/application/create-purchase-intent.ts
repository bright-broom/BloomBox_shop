import { quoteLoyalty, LoyaltyUnavailableError } from "@/modules/customer/public";
import type { CustomerPurchasePerformance } from "@/modules/order/public";
import { anonymousPurchaseCustomer, type CurrentPurchaseCustomer } from "./current-purchase-customer";
import { purchaseCustomer, assertPurchaseCustomer, type PurchaseCustomer } from "../domain/purchase-customer";
import { productId, type ProductRepository } from "@/modules/catalog/public";
import { assertAvailableDeliveryDate } from "@/modules/fulfillment/public";
import { multiplyMoney } from "@/shared/domain/money";
import { BUSINESS_TIME_ZONE } from "@/shared/domain/time";
import { CheckoutPausedError } from "./checkout-paused-error";
import { assertPreviewQuantity } from "../domain/preview-pricing";
import { quotePurchaseShipping, ShippingPriceUnavailableError } from "../domain/purchase-shipping";
import {
  catalogProductReference,
  commerceProductReference,
  PurchaseIntent,
  purchaseIntentId,
} from "../domain/purchase-intent";
import {
  giftQuantity,
  giftMessage,
  recipientName,
} from "../domain/purchase-intent-policy";
import type { PurchaseIntentRepository } from "../domain/purchase-intent-repository";
import { PurchaseIntentAlreadyExistsError } from "../domain/purchase-intent-repository";

export class ProductUnavailableError extends Error {
  constructor() {
    super("選択された花は現在ご注文いただけません。");
    this.name = "ProductUnavailableError";
  }
}

export type CreatePurchaseIntentInput = Readonly<{
  requestId: string;
  productId: string;
  quantity: number;
  recipientName: string;
  deliveryDate: string;
  giftMessage: string;
}>;

export class CreatePurchaseIntent {
  constructor(
    private readonly products: ProductRepository,
    private readonly intents: PurchaseIntentRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly acceptsNewCheckout: () => boolean = () => true,
    private readonly currentCustomer: CurrentPurchaseCustomer = anonymousPurchaseCustomer,
    private readonly performance?: CustomerPurchasePerformance,
  ) {}

  async execute(input: CreatePurchaseIntentInput): Promise<PurchaseIntent> {
    if (!this.acceptsNewCheckout()) throw new CheckoutPausedError();
    const id = purchaseIntentId(input.requestId);
    const normalizedRecipientName = recipientName(input.recipientName);
    const normalizedGiftMessage = giftMessage(input.giftMessage);
    const normalizedQuantity = giftQuantity(input.quantity);
    const customer = purchaseCustomer(await this.currentCustomer());
    const existing = await this.intents.findById(id);
    if (existing) return assertIdempotentMatch(
      existing,
      input,
      normalizedRecipientName,
      normalizedGiftMessage,
      normalizedQuantity,
      customer,
    );

    const product = await this.products.findById(productId(input.productId));
    if (!product?.available) {
      throw new ProductUnavailableError();
    }
    assertPreviewQuantity(normalizedQuantity, Boolean(product.previewOffer));
    const shippingAmount = product.shippingAmount ?? product.previewOffer?.shippingAmount;
    if (product.id.startsWith("native_") && shippingAmount === undefined) throw new ShippingPriceUnavailableError();

    const createdAt = this.now();
    assertAvailableDeliveryDate(input.deliveryDate, createdAt);
    const subtotal = multiplyMoney(product.price, normalizedQuantity);
    let loyalty = null;
    if (customer && product.id.startsWith("native_")) {
      if (!this.performance) throw new LoyaltyUnavailableError();
      try { loyalty = quoteLoyalty(await this.performance.readEligibleSpend(customer.customerId), subtotal.amount); }
      catch { throw new LoyaltyUnavailableError(); }
    }
    const intent = PurchaseIntent.create({
      id,
      displayId: createDisplayId(createdAt, id),
      item: {
        productId: catalogProductReference(product.id),
        externalProductReference: commerceProductReference(product.externalReference),
        productName: product.name,
        quantity: normalizedQuantity,
        unitPriceSnapshot: product.price,
        subtotal,
      },
      recipient: {
        name: normalizedRecipientName,
        deliveryDate: input.deliveryDate,
      },
      giftMessage: normalizedGiftMessage,
      createdAt,
      customer,
      loyalty,
      shippingAmount: shippingAmount === undefined ? null : quotePurchaseShipping(shippingAmount, normalizedQuantity),
    });

    intent.transitionTo("READY_FOR_CHECKOUT");
    try {
      await this.intents.save(intent);
    } catch (error) {
      if (!(error instanceof PurchaseIntentAlreadyExistsError)) throw error;
      const concurrentlyCreated = await this.intents.findById(id);
      if (!concurrentlyCreated) throw error;
      return assertIdempotentMatch(
        concurrentlyCreated,
        input,
        normalizedRecipientName,
        normalizedGiftMessage,
        normalizedQuantity,
        customer,
      );
    }
    return intent;
  }
}

export class PurchaseIntentIdempotencyConflictError extends Error {
  constructor() {
    super("同じ操作 ID が異なる購入内容に使用されました。ページを更新してもう一度お試しください。");
    this.name = "PurchaseIntentIdempotencyConflictError";
  }
}

function assertIdempotentMatch(
  existing: PurchaseIntent,
  input: CreatePurchaseIntentInput,
  normalizedRecipientName: ReturnType<typeof recipientName>,
  normalizedGiftMessage: ReturnType<typeof giftMessage>,
  normalizedQuantity: number,
  customer: PurchaseCustomer | null,
): PurchaseIntent {
  assertPurchaseCustomer(existing.customer, customer);
  if (
    existing.item.productId !== input.productId
    || existing.item.quantity !== normalizedQuantity
    || existing.recipient.name !== normalizedRecipientName
    || existing.recipient.deliveryDate !== input.deliveryDate
    || existing.giftMessage !== normalizedGiftMessage
  ) {
    throw new PurchaseIntentIdempotencyConflictError();
  }
  return existing;
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
