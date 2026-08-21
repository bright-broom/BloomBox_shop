import { beforeEach, describe, expect, it } from "vitest";
import { getEarliestDeliveryDate } from "@/modules/fulfillment/public";
import {
  completePreviewCheckout,
  acceptPreviewReview,
  PREVIEW_SHIPPING_AMOUNT,
  readCart,
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

  it("validates cart data read from untrusted browser storage", () => {
    storage.setItem("bloombox.checkout.cart.v1", JSON.stringify({ ...cart, quantity: 99 }));

    expect(readCart(storage)).toBeNull();
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
