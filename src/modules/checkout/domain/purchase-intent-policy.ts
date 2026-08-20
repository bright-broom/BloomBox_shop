export const GIFT_MESSAGE_MAX_LENGTH = 180;
export const RECIPIENT_NAME_MAX_LENGTH = 80;
export const PURCHASE_INTENT_EXPIRY_HOURS = 24;
export const PURCHASE_INTENT_PII_RETENTION_DAYS = 30;

export type GiftMessage = string & { readonly __brand: "GiftMessage" };
export type RecipientName = string & { readonly __brand: "RecipientName" };

export function giftMessage(value: string): GiftMessage {
  const normalized = value.trim();
  if (!normalized || normalized.length > GIFT_MESSAGE_MAX_LENGTH) {
    throw new InvalidPurchaseIntentInputError("ギフトメッセージの内容を確認してください。");
  }
  return normalized as GiftMessage;
}

export function recipientName(value: string): RecipientName {
  const normalized = value.trim();
  if (!normalized || normalized.length > RECIPIENT_NAME_MAX_LENGTH) {
    throw new InvalidPurchaseIntentInputError("お届け先のお名前を確認してください。");
  }
  return normalized as RecipientName;
}

export class InvalidPurchaseIntentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPurchaseIntentInputError";
  }
}

export function purchaseIntentExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PURCHASE_INTENT_EXPIRY_HOURS * 60 * 60 * 1000);
}

export function purchaseIntentPiiRetentionExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PURCHASE_INTENT_PII_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
