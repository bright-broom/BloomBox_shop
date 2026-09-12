import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PreviewPayment } from "@/ui/preview-payment";
import { getEarliestDeliveryDate } from "@/modules/fulfillment/public";
import { acceptPreviewReview, readPreviewReceipt, readRecoverableCart, removeCart, storeCart, storePreviewBuyer, storePreviewDraft } from "./browser-checkout-session";
import type { settlePreviewReferralAction } from "./preview-referral-actions";

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
vi.mock("./preview-referral-actions", () => ({ quotePreviewReferralAction: vi.fn(), settlePreviewReferralAction: harness.settle }));
vi.mock("@/ui/use-checkout-session-revision", async (original) => ({
  ...await original<typeof import("@/ui/use-checkout-session-revision")>(), useCheckoutSessionRevision: () => "test",
}));

function elements(node: ReactNode): Array<Record<string, unknown>> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [{ ...child.props, elementType: child.type }, ...elements(child.props.children)];
  });
}
function render() { harness.cursor = 0; return PreviewPayment({ enabled: true }); }
function optOut() {
  const change = elements(render()).find((item) => item.elementType === "input" && item.type === "checkbox")?.onChange;
  if (typeof change !== "function") throw new Error("Missing referral opt-out");
  change({ target: { checked: true } });
}
async function pay() {
  const action = elements(render()).find((item) => item.elementType === "button" && item.className === "primary-button form-submit")?.onClick;
  if (typeof action !== "function") throw new Error("Missing payment action");
  await action();
}
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
const requestId = "12345678-abcd-4000-8000-123456789012";
const nextRequestId = "22345678-abcd-4000-8000-123456789012";
function seed(id = requestId, productId = "test-product") {
  const deliveryDate = getEarliestDeliveryDate();
  storeCart(storage, { version: 1, requestId: id, productId, productName: "テスト商品", unitAmount: 4000,
    quantity: 1, recipientName: "テスト", giftMessage: "テスト", deliveryDate });
  storePreviewBuyer(storage, { buyerName: "テスト", email: "test@example.com", phone: "09012345678", postalCode: "1000001",
    prefecture: "東京都", city: "テスト市", addressLine1: "テスト番地", addressLine2: "" });
  storePreviewDraft(storage, { version: 1, displayId: "BB-BINDING", productName: "テスト商品", quantity: 1, deliveryDate, subtotalAmount: 4000, shippingAmount: 1000 });
  acceptPreviewReview(storage);
}
type SettlementResult = Awaited<ReturnType<typeof settlePreviewReferralAction>>;
function deferredSettlement() {
  let resolve!: (result: SettlementResult) => void;
  const promise = new Promise<SettlementResult>((done) => { resolve = done; });
  harness.settle.mockReturnValueOnce(promise);
  return resolve;
}
const quote = { requestId, productId: "test-product", quantity: 1, subtotalAmount: 4000,
  shippingAmount: 1000, totalAmount: 5000, discountAmount: 0, couponId: null, tracked: false };

beforeEach(() => {
  harness.values = []; harness.cursor = 0; harness.replace.mockReset(); harness.settle.mockReset(); values.clear();
  vi.stubGlobal("window", { sessionStorage: storage, dispatchEvent: vi.fn() });
  seed();
  storage.setItem("bloombox.preview-metrics.v1", JSON.stringify({ enabled: true, events: [] }));
});
afterEach(() => vi.unstubAllGlobals());

it.each(["test-product", "different-product"])("preserves the new %s cart after a delayed unavailable response", async (productId) => {
  optOut();
  const resolve = deferredSettlement();
  const pending = pay();
  expect(harness.settle).toHaveBeenCalledTimes(1);
  seed(nextRequestId, productId);
  const snapshot = new Map(values);
  const metrics = storage.getItem("bloombox.preview-metrics.v1");
  resolve({ unavailable: true });
  await pending;
  expect(harness.replace).not.toHaveBeenCalled();
  expect(values).toEqual(snapshot);
  expect(readRecoverableCart(storage)?.requestId).toBe(nextRequestId);
  expect(readPreviewReceipt(storage)).toBeNull();
  expect(storage.getItem("bloombox.preview-metrics.v1")).toBe(metrics);
  expect(elements(render()).some((item) => item.role === "alert" && String(item.children).includes("注文内容をもう一度"))).toBe(true);
});

it("does not recreate a deleted cart after a delayed unavailable response", async () => {
  optOut(); const resolve = deferredSettlement(); const pending = pay();
  removeCart(storage);
  resolve({ unavailable: true }); await pending;
  expect(harness.replace).not.toHaveBeenCalled();
  expect(readRecoverableCart(storage)).toBeNull();
  expect(readPreviewReceipt(storage)).toBeNull();
});

it.each(["unavailable", "quote"])("completes an unchanged cart after a delayed %s response", async (result) => {
  optOut(); const resolve = deferredSettlement(); const pending = pay();
  resolve(result === "quote" ? { quote } : { unavailable: true }); await pending;
  expect(harness.replace).toHaveBeenCalledExactlyOnceWith("/checkout/test/complete");
  expect(readPreviewReceipt(storage)).toMatchObject({ requestId, totalAmount: 5000 });
  expect(readRecoverableCart(storage)).toBeNull();
});

it("requires opt-out before completing without a settlement", async () => {
  const resolve = deferredSettlement(); const pending = pay();
  resolve({ unavailable: true }); await pending;
  expect(harness.replace).not.toHaveBeenCalled();
  expect(readPreviewReceipt(storage)).toBeNull();
  expect(readRecoverableCart(storage)?.requestId).toBe(requestId);
});

it("also preserves a new cart when an old settlement quote arrives", async () => {
  const resolve = deferredSettlement(); const pending = pay();
  seed(nextRequestId);
  const snapshot = new Map(values);
  resolve({ quote }); await pending;
  expect(harness.replace).not.toHaveBeenCalled();
  expect(values).toEqual(snapshot);
  expect(readPreviewReceipt(storage)).toBeNull();
});
