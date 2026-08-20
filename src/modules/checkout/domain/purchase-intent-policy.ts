export const GIFT_MESSAGE_MAX_LENGTH = 180;
export const RECIPIENT_NAME_MAX_LENGTH = 80;

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
