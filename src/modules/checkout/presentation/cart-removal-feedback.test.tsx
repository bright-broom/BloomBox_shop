import { loyaltyProgress } from "@/modules/customer/public";
import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartPage } from "@/ui/cart-page";
import { getEarliestDeliveryDate } from "@/modules/fulfillment/public";
import { CartChangedError, readRecoverableCart, storeCart } from "./browser-checkout-session";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";

const harness = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, pending: false }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (index >= harness.values.length) harness.values.push(initial);
    return [harness.values[index], (next: unknown) => { harness.values[index] = next; }];
  },
  useActionState: () => [{}, vi.fn(), harness.pending],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const actions = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("./actions", () => ({ createPurchaseIntentAction: vi.fn(), cancelPurchaseIntentAction: actions.cancel }));
vi.mock("@/ui/use-checkout-session-revision", async (original) => ({
  ...await original<typeof import("@/ui/use-checkout-session-revision")>(),
  useCheckoutSessionRevision: () => "test",
}));

function elements(node: ReactNode): Array<Record<string, unknown>> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [{ ...child.props, elementType: child.type }, ...elements(child.props.children)];
  });
}
function render(catalogPrices: Parameters<typeof CartPage>[0]["catalogPrices"] = [], previewMode = true) {
  harness.cursor = 0;
  return CartPage({ added: false, checkoutCancelled: false, previewMode, catalogPrices });
}
function removeButton(tree: ReactNode) {
  const button = elements(tree).find((item) => item.elementType === "button" && item.children === "カートから削除");
  if (!button || typeof button.onClick !== "function") throw new Error("Missing remove button");
  return { disabled: button.disabled, click: button.onClick };
}
function alerts(tree: ReactNode) { return elements(tree).filter((item) => item.role === "alert"); }
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: vi.fn((key: string) => { values.delete(key); }),
};

beforeEach(() => {
  harness.values = []; harness.cursor = 0; harness.pending = false; actions.cancel.mockReset();
  values.clear(); storage.removeItem.mockReset().mockImplementation((key) => { values.delete(key); });
  vi.stubGlobal("window", { sessionStorage: storage, dispatchEvent: vi.fn() });
  storeCart(storage, { version: 1, requestId: "12345678-abcd-4000-8000-123456789012",
    productId: "test-product", productName: "テスト商品", unitAmount: 4000, quantity: 1,
    recipientName: "テスト", giftMessage: "テスト", deliveryDate: getEarliestDeliveryDate() });
  storage.removeItem.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  { shipping: undefined, quantity: 1, blocked: true },
  { shipping: 0, quantity: 1, blocked: false },
  { shipping: 1000, quantity: 2, blocked: true },
])("keeps the cart recoverable when shipping is unavailable: %j", ({ shipping, quantity, blocked }) => {
  const cart = readRecoverableCart(storage);
  if (!cart) throw new Error("Missing fixture cart");
  const productId = "native_12345678-abcd-4000-8000-123456789012";
  storeCart(storage, { ...cart, productId, quantity });
  const tree = render(shipping === undefined ? [] : [{ productId, unitAmount: 4000, shippingAmount: shipping }]);
  const submit = elements(tree).find((item) => item.elementType === "button" && item.type === "submit");
  expect(submit?.disabled).toBe(blocked);
  expect(alerts(tree).length).toBe(blocked ? 1 : 0);
  expect(elements(tree).some((item) => item.href === `/gift/${productId}`)).toBe(true);
  expect(readRecoverableCart(storage)).toMatchObject({ recipientName: cart.recipientName, giftMessage: cart.giftMessage });
});

it.each(["SecurityError", "QuotaExceededError"])("shows retry feedback after %s and reaches the empty cart after retry", (name) => {
  storage.removeItem.mockImplementationOnce(() => { throw new DOMException("private detail", name); });
  expect(() => removeButton(render()).click()).not.toThrow();
  expect(readRecoverableCart(storage)).not.toBeNull();
  const failed = render();
  expect(alerts(failed)).toHaveLength(1);
  expect(alerts(failed)[0].children).toContain("カートを削除できませんでした");
  expect(alerts(failed)[0].children).not.toContain("private detail");
  expect(removeButton(failed).disabled).toBe(false);
  removeButton(failed).click();
  expect(readRecoverableCart(storage)).toBeNull();
  expect(alerts(render())).toEqual([]);
  expect(elements(render()).some((item) => item.children === "カートは空です。")).toBe(true);
});

it("catches sessionStorage property denial after the cart was rendered", () => {
  const button = removeButton(render());
  Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new DOMException("private detail", "SecurityError"); } });
  expect(() => button.click()).not.toThrow();
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: storage });
  expect(alerts(render())).toHaveLength(1);
  expect(storage.removeItem).not.toHaveBeenCalled();
  removeButton(render()).click();
  expect(readRecoverableCart(storage)).toBeNull();
});

it("prevents removal while purchase preparation is pending", () => {
  harness.pending = true;
  const button = removeButton(render());
  expect(button.disabled).toBe(true);
  button.click();
  expect(storage.removeItem).not.toHaveBeenCalled();
  expect(readRecoverableCart(storage)).not.toBeNull();
  harness.pending = false;
  removeButton(render()).click();
  expect(readRecoverableCart(storage)).toBeNull();
});

it.each(["ready", "unavailable", "preview"] as const)("keeps native cart rewards explicit in %s state", (state) => {
  const cart = readRecoverableCart(storage);
  if (!cart) throw new Error("Missing fixture cart");
  const productId = "native_12345678-abcd-4000-8000-123456789012";
  storeCart(storage, { ...cart, productId, unitAmount: 1 }); // Server catalog replaces stale/browser prices.
  const tree = CartPage({ added: false, checkoutCancelled: false, previewMode: state === "preview",
    catalogPrices: [{ productId, unitAmount: 4000, shippingAmount: 1000 }],
    loyalty: state === "unavailable" ? { status: "unavailable" } : { status: "ready", progress: loyaltyProgress(12000) } });
  const nodes = elements(tree), text = nodes.flatMap((item) => Array.isArray(item.children) ? item.children : [item.children]).filter((child) => typeof child === "string" || typeof child === "number").join(" ");
  const submit = nodes.find((item) => item.elementType === "button" && item.type === "submit");
  expect(submit?.disabled).toBe(state === "unavailable");
  if (state === "ready") { expect(text).toContain("4,920"); expect(text).toContain("会員割引"); }
  else expect(text).not.toContain("会員割引");
  if (state === "unavailable") expect(alerts(tree)).toHaveLength(1);
  if (state === "preview") expect(text).toContain("5,000");
});

describe("production cart removal cancels the prepared purchase first", () => {
  const requestId = "12345678-abcd-4000-8000-123456789012";
  function cartButton(tree: ReactNode) {
    const button = elements(tree).find((item) => item.elementType === "button" && item.className === "text-button");
    if (!button || typeof button.onClick !== "function") throw new Error("Missing cart button");
    return { disabled: button.disabled, children: button.children, click: button.onClick };
  }
  function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  it.each([{ status: "cancelled" }, { status: "not_prepared" }] as const)("keeps the cart until the server reports %j", async (result) => {
    const pendingCancel = deferred<typeof result>();
    actions.cancel.mockReturnValue(pendingCancel.promise);
    cartButton(render([], false)).click();
    expect(actions.cancel).toHaveBeenCalledExactlyOnceWith(requestId);
    const busy = render([], false);
    expect(cartButton(busy)).toMatchObject({ disabled: true, children: giftExperienceContent.cart.cancelPending });
    expect(elements(busy).find((item) => item.elementType === "button" && item.type === "submit")?.disabled).toBe(true);
    expect(elements(busy).some((item) => item.role === "status" && item.children === giftExperienceContent.cart.cancelPending)).toBe(true);
    expect(readRecoverableCart(storage)).not.toBeNull();
    pendingCancel.resolve(result);
    await vi.waitFor(() => expect(readRecoverableCart(storage)).toBeNull());
    expect(alerts(render([], false))).toEqual([]);
    expect(elements(render([], false)).some((item) => item.children === giftExperienceContent.cart.completedNotice)).toBe(false);
  });

  it("clears only the stale cart of a completed checkout and says the order was not cancelled", async () => {
    actions.cancel.mockResolvedValue({ status: "completed" });
    cartButton(render([], false)).click();
    await vi.waitFor(() => expect(readRecoverableCart(storage)).toBeNull());
    const tree = render([], false);
    expect(elements(tree).some((item) => item.role === "status" && item.children === giftExperienceContent.cart.completedNotice)).toBe(true);
    expect(elements(tree).some((item) => item.children === "カートは空です。")).toBe(true);
    expect(alerts(tree)).toEqual([]);
  });

  it("keeps the cart and explains a refused cancellation", async () => {
    actions.cancel.mockResolvedValue({ error: "決済手続きが始まっているため、この購入準備を取り消せません。" });
    cartButton(render([], false)).click();
    await vi.waitFor(() => expect(alerts(render([], false))).toHaveLength(1));
    const tree = render([], false);
    expect(alerts(tree)[0].children).toContain("取り消せません");
    expect(cartButton(tree)).toMatchObject({ disabled: false, children: "カートから削除" });
    expect(readRecoverableCart(storage)?.requestId).toBe(requestId);
  });

  it("keeps the cart when the server action cannot be reached", async () => {
    actions.cancel.mockRejectedValue(new Error("private network detail"));
    cartButton(render([], false)).click();
    await vi.waitFor(() => expect(alerts(render([], false))).toHaveLength(1));
    expect(alerts(render([], false))[0].children).toBe(giftExperienceContent.cart.cancelFailed);
    expect(readRecoverableCart(storage)).not.toBeNull();
  });

  it("never removes a different cart that replaced the cancelled one", async () => {
    const pendingCancel = deferred<{ status: "cancelled" }>();
    actions.cancel.mockReturnValue(pendingCancel.promise);
    cartButton(render([], false)).click();
    const replacement = readRecoverableCart(storage);
    if (!replacement) throw new Error("Missing fixture cart");
    const replacementId = "87654321-abcd-4000-8000-123456789012";
    storeCart(storage, { ...replacement, requestId: replacementId });
    pendingCancel.resolve({ status: "cancelled" });
    await vi.waitFor(() => expect(alerts(render([], false))).toHaveLength(1));
    expect(alerts(render([], false))[0].children).toBe(new CartChangedError().message);
    expect(readRecoverableCart(storage)?.requestId).toBe(replacementId);
  });

  it("leaves preview removal local", () => {
    cartButton(render()).click();
    expect(actions.cancel).not.toHaveBeenCalled();
    expect(readRecoverableCart(storage)).toBeNull();
  });
});
