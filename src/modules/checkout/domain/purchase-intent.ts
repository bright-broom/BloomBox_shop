import type { Money } from "@/shared/domain/money";
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

export function purchaseIntentId(value: string): PurchaseIntentId {
  if (!value.trim()) throw new InvalidPurchaseIntentIdError();
  return value as PurchaseIntentId;
}

export function catalogProductReference(value: string): CatalogProductReference {
  if (!value.trim()) throw new InvalidCatalogProductReferenceError();
  return value as CatalogProductReference;
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
  ) {
    this.currentStatus = status;
  }

  static create(input: {
    id: PurchaseIntentId;
    displayId: string;
    item: PurchaseIntentItem;
    recipient: IntendedRecipient;
    giftMessage: GiftMessage;
    createdAt: Date;
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
    );
  }

  static restore(input: {
    id: PurchaseIntentId;
    displayId: string;
    item: PurchaseIntentItem;
    recipient: IntendedRecipient;
    giftMessage: GiftMessage;
    createdAt: Date;
    expiresAt: Date;
    piiRetentionExpiresAt: Date;
    status: PurchaseIntentStatus;
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
    );
  }

  get status(): PurchaseIntentStatus {
    return this.currentStatus;
  }

  transitionTo(nextStatus: PurchaseIntentStatus): void {
    assertPurchaseIntentTransition(this.currentStatus, nextStatus);
    this.currentStatus = nextStatus;
  }
}
