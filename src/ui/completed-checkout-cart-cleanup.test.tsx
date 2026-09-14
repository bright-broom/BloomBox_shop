import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEarliestDeliveryDate } from "@/modules/fulfillment/public";
import { readRecoverableCart, storeCart } from "@/modules/checkout/presentation/browser-checkout-session";
import { clearCompletedCheckoutCart, CompletedCheckoutCartCleanup } from "./completed-checkout-cart-cleanup";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void) => { effect(); },
}));

const purchaseIntentId = "12345678-abcd-4000-8000-123456789012";
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
const dispatchEvent = vi.fn();

function storeCartFor(requestId: string) {
  storeCart(storage, { version: 1, requestId, productId: "native_12345678-abcd-4000-8000-123456789012", productName: "BLOOM BOX M",
    unitAmount: 4000, quantity: 1, recipientName: "テスト", giftMessage: "テスト", deliveryDate: getEarliestDeliveryDate() });
}

beforeEach(() => {
  values.clear();
  dispatchEvent.mockReset();
  vi.stubGlobal("window", { sessionStorage: storage, dispatchEvent });
});
afterEach(() => vi.unstubAllGlobals());

describe("clearing the browser cart after a completed checkout", () => {
  it("removes the cart that started the checkout and tells other checkout screens", () => {
    storeCartFor(purchaseIntentId);
    dispatchEvent.mockClear();
    expect(clearCompletedCheckoutCart(() => storage, purchaseIntentId)).toBe("cleared");
    expect(readRecoverableCart(storage)).toBeNull();
    expect(dispatchEvent).toHaveBeenCalled();
  });

  it("keeps a different cart the customer started afterwards", () => {
    const laterRequestId = "87654321-abcd-4000-8000-123456789012";
    storeCartFor(laterRequestId);
    expect(clearCompletedCheckoutCart(() => storage, purchaseIntentId)).toBe("kept");
    expect(readRecoverableCart(storage)?.requestId).toBe(laterRequestId);
  });

  it("does nothing when there is no cart", () => {
    expect(clearCompletedCheckoutCart(() => storage, purchaseIntentId)).toBe("kept");
  });

  it("does not throw when browser storage is unavailable", () => {
    const denied = () => { throw new DOMException("private detail", "SecurityError"); };
    expect(clearCompletedCheckoutCart(denied, purchaseIntentId)).toBe("unavailable");
  });

  it("clears the matching cart when the success page mounts the cleanup", () => {
    storeCartFor(purchaseIntentId);
    expect(CompletedCheckoutCartCleanup({ purchaseIntentId })).toBeNull();
    expect(readRecoverableCart(storage)).toBeNull();
  });
});
