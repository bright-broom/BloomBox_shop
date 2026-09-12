import { z } from "zod";
import {
  formatPostalCode,
  isValidPostalCode,
  JAPAN_PREFECTURES,
} from "@/modules/fulfillment/public";
import { createPurchaseIntentSchema } from "./create-purchase-intent-schema";
import type { PreviewReferralQuote } from "./preview-referral-actions";
import { recordPreviewMetric } from "@/shared/infrastructure/preview-metrics";
import { PREVIEW_SHIPPING_AMOUNT, previewTotals } from "../domain/preview-pricing";
export { PREVIEW_SHIPPING_AMOUNT } from "../domain/preview-pricing";

const CART_STORAGE_KEY = "bloombox.checkout.cart.v1";
const BUYER_STORAGE_KEY = "bloombox.checkout.buyer.v1";
const DRAFT_STORAGE_KEY = "bloombox.checkout.preview-draft.v1";
const REVIEW_STORAGE_KEY = "bloombox.checkout.preview-review.v1";
const RECEIPT_STORAGE_KEY = "bloombox.checkout.preview-receipt.v1";

export const CHECKOUT_SESSION_CHANGED_EVENT = "bloombox:checkout-session-changed";
export const CHECKOUT_SESSION_UNAVAILABLE = "unavailable";
export const PREVIEW_PAYMENT_LAST_FOUR = "4242";

// A valid stored draft may need a new delivery date. Reading must not hide it.
const recoverableCartItemSchema = createPurchaseIntentSchema.extend({
  deliveryDate: z.iso.date(),
  version: z.literal(1),
  productName: z.string().trim().min(1).max(80),
  unitAmount: z.number().int().nonnegative(),
});

const cartItemSchema = recoverableCartItemSchema.extend({
  deliveryDate: createPurchaseIntentSchema.shape.deliveryDate,
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
  shippingAmount: z.number().int().nonnegative().default(PREVIEW_SHIPPING_AMOUNT),
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
  discountAmount: z.number().int().nonnegative().default(0),
  requestId: z.uuid().optional(),
  referralTracked: z.boolean().default(false),
});

export type BrowserCartItem = z.infer<typeof cartItemSchema>;
export type PreviewBuyer = z.infer<typeof previewBuyerSchema>;
export type PreviewDraft = z.infer<typeof previewDraftSchema>;
export type PreviewReview = z.infer<typeof previewReviewSchema>;
export type PreviewReceipt = z.infer<typeof previewReceiptSchema>;

type CheckoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Catch access to the browser property as well as failures reading individual keys. */
export function readBrowserCheckoutSessionSnapshot(): string {
  try {
    return readCheckoutSessionSnapshot(window.sessionStorage);
  } catch {
    return CHECKOUT_SESSION_UNAVAILABLE;
  }
}

/** Null means unreadable; zero is reserved for a readable, empty cart. */
export function readBrowserCartQuantity(): number | null {
  try {
    return readRecoverableCart(window.sessionStorage)?.quantity ?? 0;
  } catch {
    return null;
  }
}

export function readCart(storage: CheckoutStorage): BrowserCartItem | null {
  return readStored(storage, CART_STORAGE_KEY, cartItemSchema);
}

export function readRecoverableCart(storage: CheckoutStorage): BrowserCartItem | null {
  return readStored(storage, CART_STORAGE_KEY, recoverableCartItemSchema);
}

export class CartChangedError extends Error {
  constructor() {
    super("カートが変更されています。カートへ戻り、最新の内容から編集してください。");
    this.name = "CartChangedError";
  }
}

export function storeCart(
  storage: CheckoutStorage,
  cart: BrowserCartItem,
  expectedRequestId?: string | null,
): void {
  const validated = cartItemSchema.parse(cart);
  const previous = readRecoverableCart(storage);
  if (expectedRequestId !== undefined && (previous?.requestId ?? null) !== expectedRequestId) {
    throw new CartChangedError();
  }
  // A different recipient/product must not inherit the previous recipient's address.
  if (!previous || previous.productId !== validated.productId || previous.recipientName !== validated.recipientName) {
    storage.removeItem(BUYER_STORAGE_KEY);
  }
  storage.removeItem(DRAFT_STORAGE_KEY);
  storage.removeItem(REVIEW_STORAGE_KEY);
  storage.removeItem(RECEIPT_STORAGE_KEY);
  // Invalidate approval before changing the cart, even when a storage write fails.
  writeStored(storage, CART_STORAGE_KEY, validated);
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
  const validated = previewBuyerSchema.parse(buyer);
  storage.removeItem(REVIEW_STORAGE_KEY);
  writeStored(storage, BUYER_STORAGE_KEY, validated);
  notifyCheckoutSessionChanged();
}

export function readPreviewDraft(storage: CheckoutStorage): PreviewDraft | null {
  return readStored(storage, DRAFT_STORAGE_KEY, previewDraftSchema);
}

export function storePreviewDraft(storage: CheckoutStorage, draft: z.input<typeof previewDraftSchema>): void {
  writeStored(storage, DRAFT_STORAGE_KEY, previewDraftSchema.parse(draft));
  storage.removeItem(REVIEW_STORAGE_KEY);
  notifyCheckoutSessionChanged();
}

export function storePreparedPreviewDraft(storage: CheckoutStorage, requestId: string, draft: z.input<typeof previewDraftSchema>): void {
  if (readRecoverableCart(storage)?.requestId !== requestId) throw new CartChangedError();
  storePreviewDraft(storage, draft);
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

export class PreviewCheckoutCleanupError extends Error {
  constructor() {
    super("Preview receipt saved; checkout input cleanup is incomplete.");
    this.name = "PreviewCheckoutCleanupError";
  }
}

export type PreviewCheckoutCleanupStatus = "complete" | "pending" | "changed";

export function readPreviewCheckoutCleanupStatus(
  storage: CheckoutStorage,
  requestId: string | undefined,
): PreviewCheckoutCleanupStatus {
  const keys = [CART_STORAGE_KEY, BUYER_STORAGE_KEY, DRAFT_STORAGE_KEY, REVIEW_STORAGE_KEY];
  if (keys.every((key) => storage.getItem(key) === null)) return "complete";
  // Never delete input belonging to a new cart, an invalid cart, or a replaced receipt.
  if (!requestId || readPreviewReceipt(storage)?.requestId !== requestId) return "changed";
  if (storage.getItem(CART_STORAGE_KEY) !== null && readRecoverableCart(storage)?.requestId !== requestId) return "changed";
  return "pending";
}

export function cleanupPreviewCheckout(storage: CheckoutStorage, requestId: string): void {
  const status = readPreviewCheckoutCleanupStatus(storage, requestId);
  if (status === "changed") throw new CartChangedError();
  if (status === "complete") return;
  try {
    storage.removeItem(REVIEW_STORAGE_KEY);
    storage.removeItem(BUYER_STORAGE_KEY);
    storage.removeItem(DRAFT_STORAGE_KEY);
    storage.removeItem(CART_STORAGE_KEY);
  } finally {
    notifyCheckoutSessionChanged();
  }
}

export function completePreviewCheckout(
  storage: CheckoutStorage,
  completedAt = new Date(),
  settlement?: PreviewReferralQuote,
): PreviewReceipt | null {
  const cart = readCart(storage);
  const buyer = readPreviewBuyer(storage);
  const draft = readPreviewDraft(storage);
  const review = readPreviewReview(storage);
  if (!cart || !buyer || !draft || !review) return null;
  if (settlement && (
    settlement.requestId !== cart.requestId || settlement.productId !== cart.productId
    || settlement.quantity !== cart.quantity || settlement.quantity !== draft.quantity
    || settlement.subtotalAmount !== draft.subtotalAmount
    || settlement.shippingAmount !== draft.shippingAmount
    || settlement.totalAmount !== draft.subtotalAmount + draft.shippingAmount - settlement.discountAmount
    || !Number.isSafeInteger(settlement.discountAmount) || settlement.discountAmount < 0
    || settlement.discountAmount > settlement.subtotalAmount
  )) return null;

  const receipt = previewReceiptSchema.parse({
    version: 1,
    displayId: draft.displayId,
    completedAt: completedAt.toISOString(),
    productName: draft.productName,
    quantity: draft.quantity,
    deliveryDate: draft.deliveryDate,
    subtotalAmount: draft.subtotalAmount,
    shippingAmount: settlement?.shippingAmount ?? draft.shippingAmount,
    discountAmount: settlement?.discountAmount ?? 0,
    requestId: cart.requestId,
    referralTracked: settlement?.tracked ?? false,
    totalAmount: previewTotals(draft.subtotalAmount, draft.shippingAmount, settlement?.discountAmount ?? 0).totalAmount,
  });

  writeStored(storage, RECEIPT_STORAGE_KEY, receipt);
  recordPreviewMetric({ name: "preview_purchase", requestId: cart.requestId, referralUsed: receipt.discountAmount > 0 }, storage);
  try {
    cleanupPreviewCheckout(storage, cart.requestId);
  } catch {
    // The receipt is already durable. Retry cleanup without settling another test order.
    throw new PreviewCheckoutCleanupError();
  }
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
