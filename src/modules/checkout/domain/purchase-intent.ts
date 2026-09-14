import { purchaseLoyalty, InvalidPurchaseLoyaltyError, type PurchaseLoyalty } from "./purchase-loyalty";
import { quotePurchaseShipping } from "./purchase-shipping";
import { purchaseCustomer, type PurchaseCustomer } from "./purchase-customer";
import { money, type Money } from "@/shared/domain/money";
import {
  purchaseIntentExpiry,
  purchaseIntentPiiRetentionExpiry,
  type GiftMessage,
  type RecipientName,
} from "./purchase-intent-policy";
import {
  assertPurchaseIntentTransition,
  type PurchaseIntentStatus,
} from "./purchase-intent-status";

export type PurchaseIntentId = string & { readonly __brand: "PurchaseIntentId" };
export type CatalogProductReference = string & { readonly __brand: "CatalogProductReference" };
export type CommerceProductReference = string & { readonly __brand: "CommerceProductReference" };
export const COMMERCE_PROVIDERS = ["SHOPIFY", "STRIPE"] as const;
export type CommerceProvider = (typeof COMMERCE_PROVIDERS)[number];

export function purchaseIntentId(value: string): PurchaseIntentId {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new InvalidPurchaseIntentIdError();
  }
  return value as PurchaseIntentId;
}

export function catalogProductReference(value: string): CatalogProductReference {
  if (!value.trim()) throw new InvalidCatalogProductReferenceError();
  return value as CatalogProductReference;
}

export function commerceProductReference(value: string): CommerceProductReference {
  if (!value.trim()) throw new InvalidCatalogProductReferenceError();
  return value as CommerceProductReference;
}

export class InvalidPurchaseIntentIdError extends Error {
  constructor() {
    super("Purchase intent ID must not be empty");
    this.name = "InvalidPurchaseIntentIdError";
  }
}

export class InvalidCatalogProductReferenceError extends Error {
  constructor() {
    super("Catalog product reference must not be empty");
    this.name = "InvalidCatalogProductReferenceError";
  }
}

export type PurchaseIntentItem = Readonly<{
  productId: CatalogProductReference;
  externalProductReference: CommerceProductReference;
  productName: string;
  quantity: number;
  unitPriceSnapshot: Money;
  subtotal: Money;
}>;

export type IntendedRecipient = Readonly<{
  name: RecipientName;
  deliveryDate: string;
}>;

export class PurchaseIntent {
  private currentStatus: PurchaseIntentStatus;

  private constructor(
    readonly id: PurchaseIntentId,
    readonly displayId: string,
    readonly item: PurchaseIntentItem,
    readonly recipient: IntendedRecipient,
    readonly giftMessage: GiftMessage,
    readonly createdAt: Date,
    readonly expiresAt: Date,
    readonly piiRetentionExpiresAt: Date,
    status: PurchaseIntentStatus,
    private currentCommerceProvider?: CommerceProvider,
    private currentExternalCheckoutId?: string,
    private currentProviderApiVersion?: string,
    private currentCheckoutCreatedAt?: Date,
    readonly customer: PurchaseCustomer | null = null,
    readonly shippingAmount: Money | null = null,
    readonly loyalty: PurchaseLoyalty | null = null,
  ) {
    if (shippingAmount !== null) {
      quotePurchaseShipping(shippingAmount.amount, item.quantity);
      money(item.subtotal.amount + shippingAmount.amount);
    }
    if (loyalty !== null) {
      if (!customer || !item.productId.startsWith("native_") || item.quantity !== 1 || shippingAmount === null) throw new InvalidPurchaseLoyaltyError();
      this.loyalty = purchaseLoyalty(loyalty, item.subtotal.amount);
    }
    this.currentStatus = status;
  }

  static create(input: {
    id: PurchaseIntentId;
    displayId: string;
    item: PurchaseIntentItem;
    recipient: IntendedRecipient;
    giftMessage: GiftMessage;
    createdAt: Date;
    customer?: PurchaseCustomer | null;
    shippingAmount?: Money | null;
    loyalty?: PurchaseLoyalty | null;
  }): PurchaseIntent {
    return new PurchaseIntent(
      input.id,
      input.displayId,
      input.item,
      input.recipient,
      input.giftMessage,
      input.createdAt,
      purchaseIntentExpiry(input.createdAt),
      purchaseIntentPiiRetentionExpiry(input.createdAt),
      "DRAFT",
      undefined, undefined, undefined, undefined, purchaseCustomer(input.customer ?? null),
      input.shippingAmount ?? null,
      input.loyalty ?? null,
    );
  }

  static restore(input: {
    id: PurchaseIntentId;
    displayId: string;
    item: PurchaseIntentItem;
    recipient: IntendedRecipient;
    giftMessage: GiftMessage;
    createdAt: Date;
    customer?: PurchaseCustomer | null;
    shippingAmount?: Money | null;
    loyalty?: PurchaseLoyalty | null;
    expiresAt: Date;
    piiRetentionExpiresAt: Date;
    status: PurchaseIntentStatus;
    commerceProvider?: CommerceProvider;
    externalCheckoutId?: string;
    providerApiVersion?: string;
    checkoutCreatedAt?: Date;
  }): PurchaseIntent {
    return new PurchaseIntent(
      input.id,
      input.displayId,
      input.item,
      input.recipient,
      input.giftMessage,
      input.createdAt,
      input.expiresAt,
      input.piiRetentionExpiresAt,
      input.status,
      input.commerceProvider,
      input.externalCheckoutId,
      input.providerApiVersion,
      input.checkoutCreatedAt,
      purchaseCustomer(input.customer ?? null),
      input.shippingAmount ?? null,
      input.loyalty ?? null,
    );
  }

  get status(): PurchaseIntentStatus {
    return this.currentStatus;
  }

  get commerceProvider(): CommerceProvider | undefined {
    return this.currentCommerceProvider;
  }

  get externalCheckoutId(): string | undefined {
    return this.currentExternalCheckoutId;
  }

  get providerApiVersion(): string | undefined {
    return this.currentProviderApiVersion;
  }

  get checkoutCreatedAt(): Date | undefined {
    return this.currentCheckoutCreatedAt;
  }

  transitionTo(nextStatus: PurchaseIntentStatus): void {
    assertPurchaseIntentTransition(this.currentStatus, nextStatus);
    this.currentStatus = nextStatus;
  }

  selectCommerceProvider(provider: CommerceProvider): void {
    if (this.status !== "READY_FOR_CHECKOUT" || (this.currentCommerceProvider && this.currentCommerceProvider !== provider)) {
      throw new InvalidCheckoutReferenceError();
    }
    this.currentCommerceProvider = provider;
  }

  recordCheckoutCreated(input: {
    provider: CommerceProvider;
    externalCheckoutId: string;
    providerApiVersion: string;
    occurredAt: Date;
  }): void {
    if (!input.externalCheckoutId.trim() || !input.providerApiVersion.trim()
      || (this.currentCommerceProvider && this.currentCommerceProvider !== input.provider)) {
      throw new InvalidCheckoutReferenceError();
    }
    this.transitionTo("CHECKOUT_CREATED");
    this.currentCommerceProvider = input.provider;
    this.currentExternalCheckoutId = input.externalCheckoutId;
    this.currentProviderApiVersion = input.providerApiVersion;
    this.currentCheckoutCreatedAt = input.occurredAt;
  }
}

export class InvalidCheckoutReferenceError extends Error {
  constructor() {
    super("Checkout reference is invalid");
    this.name = "InvalidCheckoutReferenceError";
  }
}
