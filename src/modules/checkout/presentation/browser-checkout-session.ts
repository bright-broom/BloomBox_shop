import { z } from "zod";
import {
  formatPostalCode,
  isValidPostalCode,
  JAPAN_PREFECTURES,
} from "@/modules/fulfillment/public";
import { createPurchaseIntentSchema } from "./create-purchase-intent-schema";

const CART_STORAGE_KEY = "bloombox.checkout.cart.v1";
const BUYER_STORAGE_KEY = "bloombox.checkout.buyer.v1";
const DRAFT_STORAGE_KEY = "bloombox.checkout.preview-draft.v1";
const REVIEW_STORAGE_KEY = "bloombox.checkout.preview-review.v1";
const RECEIPT_STORAGE_KEY = "bloombox.checkout.preview-receipt.v1";

export const CHECKOUT_SESSION_CHANGED_EVENT = "bloombox:checkout-session-changed";
export const PREVIEW_SHIPPING_AMOUNT = 1_100;
export const PREVIEW_PAYMENT_LAST_FOUR = "4242";

const cartItemSchema = createPurchaseIntentSchema.extend({
  version: z.literal(1),
  productName: z.string().trim().min(1).max(80),
  unitAmount: z.number().int().nonnegative(),
});

export const previewBuyerSchema = z.object({
  buyerName: z.string().trim().min(1, "ご注文者のお名前を入力してください。").max(80),
  email: z.string().trim().pipe(z.email("メールアドレスを正しく入力してください。")),
  phone: z.string().trim().regex(/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/, "電話番号を正しく入力してください。"),
  postalCode: z.string().trim()
    .refine(isValidPostalCode, "郵便番号は 7 桁の数字で入力してください。")
    .transform(formatPostalCode),
  prefecture: z.enum(JAPAN_PREFECTURES, { error: "都道府県を選択してください。" }),
  city: z.string().trim().min(1, "市区町村を入力してください。").max(100),
  addressLine1: z.string().trim().min(1, "町名・番地を入力してください。").max(120),
  addressLine2: z.string().trim().max(120),
});

const previewDraftSchema = z.object({
  version: z.literal(1),
  displayId: z.string().trim().min(1).max(80),
  productName: z.string().trim().min(1).max(80),
  quantity: z.number().int().positive(),
  deliveryDate: z.iso.date(),
  subtotalAmount: z.number().int().nonnegative(),
});

const previewReviewSchema = z.object({
  version: z.literal(1),
  acceptedAt: z.iso.datetime(),
});

const previewReceiptSchema = z.object({
  version: z.literal(1),
  displayId: z.string().trim().min(1).max(80),
  completedAt: z.iso.datetime(),
  productName: z.string().trim().min(1).max(80),
  quantity: z.number().int().positive(),
  deliveryDate: z.iso.date(),
  subtotalAmount: z.number().int().nonnegative(),
  shippingAmount: z.number().int().nonnegative(),
  totalAmount: z.number().int().nonnegative(),
});

export type BrowserCartItem = z.infer<typeof cartItemSchema>;
export type PreviewBuyer = z.infer<typeof previewBuyerSchema>;
export type PreviewDraft = z.infer<typeof previewDraftSchema>;
export type PreviewReview = z.infer<typeof previewReviewSchema>;
export type PreviewReceipt = z.infer<typeof previewReceiptSchema>;

type CheckoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readCart(storage: CheckoutStorage): BrowserCartItem | null {
  return readStored(storage, CART_STORAGE_KEY, cartItemSchema);
}

export function storeCart(storage: CheckoutStorage, cart: BrowserCartItem): void {
  writeStored(storage, CART_STORAGE_KEY, cartItemSchema.parse(cart));
  storage.removeItem(BUYER_STORAGE_KEY);
  storage.removeItem(DRAFT_STORAGE_KEY);
  storage.removeItem(REVIEW_STORAGE_KEY);
  storage.removeItem(RECEIPT_STORAGE_KEY);
  notifyCheckoutSessionChanged();
}

export function removeCart(storage: CheckoutStorage): void {
  storage.removeItem(CART_STORAGE_KEY);
  storage.removeItem(BUYER_STORAGE_KEY);
  storage.removeItem(DRAFT_STORAGE_KEY);
  storage.removeItem(REVIEW_STORAGE_KEY);
  notifyCheckoutSessionChanged();
}

export function readPreviewBuyer(storage: CheckoutStorage): PreviewBuyer | null {
  return readStored(storage, BUYER_STORAGE_KEY, previewBuyerSchema);
}

export function storePreviewBuyer(storage: CheckoutStorage, buyer: PreviewBuyer): void {
  writeStored(storage, BUYER_STORAGE_KEY, previewBuyerSchema.parse(buyer));
  notifyCheckoutSessionChanged();
}

export function readPreviewDraft(storage: CheckoutStorage): PreviewDraft | null {
  return readStored(storage, DRAFT_STORAGE_KEY, previewDraftSchema);
}

export function storePreviewDraft(storage: CheckoutStorage, draft: PreviewDraft): void {
  writeStored(storage, DRAFT_STORAGE_KEY, previewDraftSchema.parse(draft));
  storage.removeItem(REVIEW_STORAGE_KEY);
  notifyCheckoutSessionChanged();
}

export function readPreviewReview(storage: CheckoutStorage): PreviewReview | null {
  return readStored(storage, REVIEW_STORAGE_KEY, previewReviewSchema);
}

export function acceptPreviewReview(storage: CheckoutStorage, acceptedAt = new Date()): void {
  writeStored(storage, REVIEW_STORAGE_KEY, previewReviewSchema.parse({
    version: 1,
    acceptedAt: acceptedAt.toISOString(),
  }));
  notifyCheckoutSessionChanged();
}

export function readCheckoutSessionSnapshot(storage: CheckoutStorage): string {
  const value = [
    CART_STORAGE_KEY,
    BUYER_STORAGE_KEY,
    DRAFT_STORAGE_KEY,
    REVIEW_STORAGE_KEY,
    RECEIPT_STORAGE_KEY,
  ].map((key) => storage.getItem(key) ?? "").join("\u001f");
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${value.length}:${hash >>> 0}`;
}

export function readPreviewReceipt(storage: CheckoutStorage): PreviewReceipt | null {
  return readStored(storage, RECEIPT_STORAGE_KEY, previewReceiptSchema);
}

export function completePreviewCheckout(
  storage: CheckoutStorage,
  completedAt = new Date(),
): PreviewReceipt | null {
  const cart = readCart(storage);
  const buyer = readPreviewBuyer(storage);
  const draft = readPreviewDraft(storage);
  const review = readPreviewReview(storage);
  if (!cart || !buyer || !draft || !review) return null;

  const receipt = previewReceiptSchema.parse({
    version: 1,
    displayId: draft.displayId,
    completedAt: completedAt.toISOString(),
    productName: draft.productName,
    quantity: draft.quantity,
    deliveryDate: draft.deliveryDate,
    subtotalAmount: draft.subtotalAmount,
    shippingAmount: PREVIEW_SHIPPING_AMOUNT,
    totalAmount: draft.subtotalAmount + PREVIEW_SHIPPING_AMOUNT,
  });

  writeStored(storage, RECEIPT_STORAGE_KEY, receipt);
  storage.removeItem(CART_STORAGE_KEY);
  storage.removeItem(BUYER_STORAGE_KEY);
  storage.removeItem(DRAFT_STORAGE_KEY);
  storage.removeItem(REVIEW_STORAGE_KEY);
  notifyCheckoutSessionChanged();
  return receipt;
}

function readStored<T>(storage: CheckoutStorage, key: string, schema: z.ZodType<T>): T | null {
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Invalid browser state is discarded below.
  }

  return null;
}

function writeStored<T>(storage: CheckoutStorage, key: string, value: T): void {
  storage.setItem(key, JSON.stringify(value));
}

function notifyCheckoutSessionChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHECKOUT_SESSION_CHANGED_EVENT));
  }
}
