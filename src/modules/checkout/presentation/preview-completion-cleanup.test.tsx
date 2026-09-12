import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PreviewPayment } from "@/ui/preview-payment";
import { PreviewCheckoutComplete } from "@/ui/preview-checkout-complete";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { getEarliestDeliveryDate } from "@/modules/fulfillment/public";
import { acceptPreviewReview, readPreviewReceipt, readRecoverableCart, storeCart, storePreviewBuyer, storePreviewDraft } from "./browser-checkout-session";

const harness = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, replace: vi.fn(), settle: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (index >= harness.values.length) harness.values.push(initial);
    return [harness.values[index], (next: unknown) => { harness.values[index] = next; }];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: harness.replace }) }));
vi.mock("./preview-referral-actions", () => ({ quotePreviewReferralAction: vi.fn(), settlePreviewReferralAction: harness.settle, simulateReferralOrderAction: vi.fn() }));
vi.mock("@/ui/use-checkout-session-revision", async (original) => ({
  ...await original<typeof import("@/ui/use-checkout-session-revision")>(), useCheckoutSessionRevision: () => "test",
}));

function elements(node: ReactNode): Array<Record<string, unknown>> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [{ ...child.props, elementType: child.type }, ...elements(child.props.children)];
  });
}
function click(tree: ReactNode, className: string) {
  const action = elements(tree).find((item) => item.elementType === "button" && item.className === className)?.onClick;
  if (typeof action !== "function") throw new Error("Missing action");
  return action();
}
function renderPayment() { harness.cursor = 0; return PreviewPayment({ enabled: true }); }
function renderReceipt() { harness.cursor = 0; return PreviewCheckoutComplete({ enabled: true }); }
function hasText(tree: ReactNode, text: string) { return elements(tree).some((item) => item.children === text); }
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  removeItem: vi.fn((key: string) => { values.delete(key); }),
};
const requestId = "12345678-abcd-4000-8000-123456789012";
const copy = giftExperienceContent.checkoutCleanup;

beforeEach(() => {
  harness.values = []; harness.cursor = 0; harness.replace.mockReset(); harness.settle.mockReset();
  values.clear();
  storage.setItem.mockReset().mockImplementation((key, value) => { values.set(key, value); });
  storage.removeItem.mockReset().mockImplementation((key) => { values.delete(key); });
  vi.stubGlobal("window", { sessionStorage: storage, dispatchEvent: vi.fn() });
  const deliveryDate = getEarliestDeliveryDate();
  storeCart(storage, { version: 1, requestId, productId: "test-product", productName: "テスト商品", unitAmount: 4000,
    quantity: 1, recipientName: "テスト", giftMessage: "テスト", deliveryDate });
  storePreviewBuyer(storage, { buyerName: "テスト", email: "test@example.com", phone: "09012345678", postalCode: "1000001",
    prefecture: "東京都", city: "テスト市", addressLine1: "テスト番地", addressLine2: "" });
  storePreviewDraft(storage, { version: 1, displayId: "BB-CLEANUP", productName: "テスト商品", quantity: 1, deliveryDate, subtotalAmount: 4000, shippingAmount: 1000 });
  acceptPreviewReview(storage);
  harness.settle.mockResolvedValue({ quote: { requestId, productId: "test-product", quantity: 1, subtotalAmount: 4000,
    shippingAmount: 1000, totalAmount: 5000, discountAmount: 0, couponId: null, tracked: false } });
});
afterEach(() => vi.unstubAllGlobals());

it.each(["preview-review", "buyer", "preview-draft", "cart"])("recovers completion after %s deletion fails without settling again", async (part) => {
  storage.removeItem.mockImplementation((key) => {
    if (key === `bloombox.checkout.${part}.v1`) throw new DOMException("private detail", "SecurityError");
    values.delete(key);
  });
  await click(renderPayment(), "primary-button form-submit");
  expect(harness.replace).toHaveBeenCalledExactlyOnceWith("/checkout/test/complete");
  const receipt = readPreviewReceipt(storage);
  expect(receipt?.totalAmount).toBe(5000);
  harness.values = []; // Mount the destination page (also covers opening/reloading from saved state).
  expect(hasText(renderReceipt(), copy.pending)).toBe(true);
  expect(hasText(renderReceipt(), copy.complete)).toBe(false);
  click(renderReceipt(), "secondary-button");
  expect(hasText(renderReceipt(), copy.error)).toBe(true);
  expect(hasText(renderReceipt(), "private detail")).toBe(false);
  storage.removeItem.mockImplementation((key) => { values.delete(key); });
  click(renderReceipt(), "secondary-button");
  expect(hasText(renderReceipt(), copy.complete)).toBe(true);
  expect(hasText(renderReceipt(), copy.pending)).toBe(false);
  expect(readPreviewReceipt(storage)).toEqual(receipt);
  expect(harness.settle).toHaveBeenCalledTimes(1);
});

it("retains input and stays on payment when receipt storage fails", async () => {
  storage.setItem.mockImplementation(() => { throw new DOMException("private detail", "QuotaExceededError"); });
  await click(renderPayment(), "primary-button form-submit");
  expect(harness.replace).not.toHaveBeenCalled();
  expect(readPreviewReceipt(storage)).toBeNull();
  expect(readRecoverableCart(storage)).not.toBeNull();
  expect(hasText(renderPayment(), "完了情報を保存できませんでした。同じ操作を再試行してください。")).toBe(true);
});

it("rechecks ownership when an old cleanup button is used after a different cart appears", async () => {
  storage.removeItem.mockImplementationOnce(() => { throw new DOMException("denied", "SecurityError"); });
  await click(renderPayment(), "primary-button form-submit");
  harness.values = [];
  const stale = renderReceipt();
  const nextCart = { ...readRecoverableCart(storage), requestId: "22345678-abcd-4000-8000-123456789012" };
  storage.setItem("bloombox.checkout.cart.v1", JSON.stringify(nextCart));
  storage.removeItem.mockClear();
  click(stale, "secondary-button");
  expect(storage.removeItem).not.toHaveBeenCalled();
  expect(readRecoverableCart(storage)?.requestId).toBe(nextCart.requestId);
  expect(hasText(renderReceipt(), copy.changed)).toBe(true);
  expect(hasText(renderReceipt(), copy.complete)).toBe(false);
});
