import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEarliestDeliveryDate } from "@/modules/fulfillment/public";
import {
  CartChangedError,
  completePreviewCheckout,
  acceptPreviewReview,
  PREVIEW_SHIPPING_AMOUNT,
  readCart,
  readRecoverableCart,
  readPreviewReview,
  readCheckoutSessionSnapshot,
  readPreviewBuyer,
  readPreviewDraft,
  readPreviewReceipt,
  removeCart,
  storeCart,
  storePreviewBuyer,
  storePreviewDraft,
  type BrowserCartItem,
  type PreviewBuyer,
} from "./browser-checkout-session";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const cart: BrowserCartItem = {
  version: 1,
  requestId: "12345678-abcd-4000-8000-123456789012",
  productId: "prod_sora_02",
  productName: "空の余白",
  unitAmount: 7_200,
  quantity: 2,
  recipientName: "山田 花子",
  deliveryDate: getEarliestDeliveryDate(),
  giftMessage: "おめでとう",
};

const buyer: PreviewBuyer = {
  buyerName: "山田 太郎",
  email: "taro@example.com",
  phone: "090-1234-5678",
  postalCode: "100-0001",
  prefecture: "東京都",
  city: "千代田区",
  addressLine1: "千代田 1-1",
  addressLine2: "BloomBox ビル 2F",
};

describe("browser checkout session", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps expired delivery drafts recoverable but never checkout-ready", () => {
    storeCart(storage, cart);
    storePreviewBuyer(storage, buyer);
    storePreviewDraft(storage, previewDraft("BB-EXPIRED"));
    acceptPreviewReview(storage);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${cart.deliveryDate}T00:00:00+09:00`));

    expect(readRecoverableCart(storage)).toEqual(cart);
    expect(readCart(storage)).toBeNull();
    expect(completePreviewCheckout(storage)).toBeNull();
    expect(() => storeCart(storage, cart)).toThrow();
    expect(readRecoverableCart(storage)).toEqual(cart);

    const renewed = { ...cart, requestId: "22345678-abcd-4000-8000-123456789012", deliveryDate: getEarliestDeliveryDate() };
    storeCart(storage, renewed, cart.requestId);
    expect(readCart(storage)).toEqual(renewed);
    expect(readPreviewDraft(storage)).toBeNull();
    expect(readPreviewReview(storage)).toBeNull();
  });

  it.each(["2026-02-30", "not-a-date"])("never recovers malformed date %s", (deliveryDate) => {
    storage.setItem("bloombox.checkout.cart.v1", JSON.stringify({ ...cart, deliveryDate }));
    expect(readRecoverableCart(storage)).toBeNull();
  });

  it("does not relax quantity validation when recovering a draft", () => {
    storage.setItem("bloombox.checkout.cart.v1", JSON.stringify({ ...cart, quantity: 99 }));
    expect(readRecoverableCart(storage)).toBeNull();
  });

  it("keeps the same recipient's address while invalidating the previous amount and consent", () => {
    storeCart(storage, cart);
    storePreviewBuyer(storage, buyer);
    storePreviewDraft(storage, previewDraft("BB-BEFORE-EDIT"));
    acceptPreviewReview(storage);
    const updated = { ...cart, requestId: "22345678-abcd-4000-8000-123456789012", quantity: 3, giftMessage: "ありがとう" };

    storeCart(storage, updated, cart.requestId);

    expect(readCart(storage)).toEqual(updated);
    expect(readPreviewBuyer(storage)).toEqual(buyer);
    expect(readPreviewDraft(storage)).toBeNull();
    expect(readPreviewReview(storage)).toBeNull();
    expect(completePreviewCheckout(storage)).toBeNull();
  });

  it.each([
    { recipientName: "別の受取人" },
    { productId: "prod_other_03" },
  ])("clears previous address when recipient/product changes: %j", (change) => {
    storeCart(storage, cart);
    storePreviewBuyer(storage, buyer);
    storeCart(storage, { ...cart, ...change }, cart.requestId);
    expect(readPreviewBuyer(storage)).toBeNull();
  });

  it("requires a new review after editing buyer or delivery address details", () => {
    storeCart(storage, cart);
    storePreviewBuyer(storage, buyer);
    storePreviewDraft(storage, previewDraft("BB-BUYER-EDIT"));
    acceptPreviewReview(storage);

    storePreviewBuyer(storage, { ...buyer, addressLine1: "変更後の配送先 2-2" });

    expect(readPreviewDraft(storage)).not.toBeNull();
    expect(readPreviewReview(storage)).toBeNull();
    expect(completePreviewCheckout(storage)).toBeNull();
  });

  it("rejects stale edits without modifying the newer cart or checkout progress", () => {
    storeCart(storage, cart);
    storePreviewBuyer(storage, buyer);
    storePreviewDraft(storage, previewDraft("BB-NEWER"));
    acceptPreviewReview(storage);
    const revision = readCheckoutSessionSnapshot(storage);

    expect(() => storeCart(storage, { ...cart, quantity: 3 }, "22345678-abcd-4000-8000-123456789012"))
      .toThrow(CartChangedError);
    expect(() => storeCart(storage, cart, null)).toThrow(CartChangedError);
    expect(readCheckoutSessionSnapshot(storage)).toBe(revision);
  });

  it("retains the old cart and invalidates approval if the edited cart cannot be written", () => {
    storeCart(storage, cart);
    storePreviewBuyer(storage, buyer);
    storePreviewDraft(storage, previewDraft("BB-BEFORE-FAILURE"));
    acceptPreviewReview(storage);
    vi.spyOn(storage, "setItem").mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });

    expect(() => storeCart(storage, { ...cart, quantity: 3 }, cart.requestId)).toThrow("QuotaExceededError");
    expect(readCart(storage)).toEqual(cart);
    expect(readPreviewDraft(storage)).toBeNull();
    expect(readPreviewReview(storage)).toBeNull();
    expect(completePreviewCheckout(storage)).toBeNull();
  });

  it("validates cart data read from untrusted browser storage", () => {
    storage.setItem("bloombox.checkout.cart.v1", JSON.stringify({ ...cart, quantity: 99 }));

    expect(readCart(storage)).toBeNull();
  });

  it("normalizes a full-width postal code before storing buyer data", () => {
    storePreviewBuyer(storage, { ...buyer, postalCode: "１００－０００１" });

    expect(readPreviewBuyer(storage)?.postalCode).toBe("100-0001");
  });

  it("replaces the one-destination cart and clears stale checkout progress", () => {
    storePreviewBuyer(storage, buyer);
    storePreviewDraft(storage, previewDraft("BB-OLD"));

    storeCart(storage, cart);

    expect(readCart(storage)).toEqual(cart);
    expect(readPreviewBuyer(storage)).toBeNull();
    expect(readPreviewDraft(storage)).toBeNull();
  });

  it("creates a minimal receipt and removes buyer PII after a successful dummy payment", () => {
    storeCart(storage, cart);
    storePreviewBuyer(storage, buyer);
    storePreviewDraft(storage, previewDraft("BB-TEST-1234"));
    acceptPreviewReview(storage, new Date("2026-08-22T07:59:00.000Z"));

    const receipt = completePreviewCheckout(storage, new Date("2026-08-22T08:00:00.000Z"));

    expect(receipt).toEqual(expect.objectContaining({
      displayId: "BB-TEST-1234",
      subtotalAmount: 14_400,
      shippingAmount: PREVIEW_SHIPPING_AMOUNT,
      totalAmount: 14_400 + PREVIEW_SHIPPING_AMOUNT,
    }));
    expect(readCart(storage)).toBeNull();
    expect(readPreviewBuyer(storage)).toBeNull();
    expect(readPreviewDraft(storage)).toBeNull();
    expect(JSON.stringify(readPreviewReceipt(storage))).not.toContain(buyer.email);
    expect(JSON.stringify(readPreviewReceipt(storage))).not.toContain(buyer.addressLine1);
  });

  it("exposes only a non-PII revision token to React subscriptions", () => {
    storeCart(storage, cart);
    storePreviewBuyer(storage, buyer);

    const snapshot = readCheckoutSessionSnapshot(storage);

    expect(snapshot).toMatch(/^\d+:\d+$/);
    expect(snapshot).not.toContain(buyer.email);
    expect(snapshot).not.toContain(buyer.addressLine1);
    expect(snapshot).not.toContain(cart.giftMessage);
  });

  it("requires review acceptance before completing a dummy payment", () => {
    storeCart(storage, cart);
    storePreviewBuyer(storage, buyer);
    storePreviewDraft(storage, previewDraft("BB-TEST-1234"));

    expect(completePreviewCheckout(storage)).toBeNull();
  });

  it("does not complete payment when required checkout state is missing", () => {
    storeCart(storage, cart);

    expect(completePreviewCheckout(storage)).toBeNull();
  });

  it("removes the cart and its dependent preview state together", () => {
    storeCart(storage, cart);
    storePreviewBuyer(storage, buyer);
    storePreviewDraft(storage, previewDraft("BB-TEST-1234"));

    removeCart(storage);

    expect(readCart(storage)).toBeNull();
    expect(readPreviewBuyer(storage)).toBeNull();
    expect(readPreviewDraft(storage)).toBeNull();
  });
});

function previewDraft(displayId: string) {
  return {
    version: 1 as const,
    displayId,
    productName: cart.productName,
    quantity: cart.quantity,
    deliveryDate: cart.deliveryDate,
    subtotalAmount: cart.unitAmount * cart.quantity,
  };
}
