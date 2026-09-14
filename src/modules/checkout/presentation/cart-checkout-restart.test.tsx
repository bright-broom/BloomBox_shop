import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartPage } from "@/ui/cart-page";
import { getEarliestDeliveryDate } from "@/modules/fulfillment/public";
import { CartChangedError, readRecoverableCart, storeCart } from "./browser-checkout-session";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";

type PurchaseAction = (previous: unknown, formData: FormData) => Promise<unknown>;
const harness = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, action: null as PurchaseAction | null }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (index >= harness.values.length) harness.values.push(initial);
    return [harness.values[index], (next: unknown) => { harness.values[index] = next; }];
  },
  useActionState: (action: PurchaseAction) => {
    harness.action = action;
    return [{}, vi.fn(), false];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const actions = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./actions", () => ({ createPurchaseIntentAction: actions.create, cancelPurchaseIntentAction: vi.fn() }));
vi.mock("@/ui/use-checkout-session-revision", async (original) => ({
  ...await original<typeof import("@/ui/use-checkout-session-revision")>(),
  useCheckoutSessionRevision: () => "test",
}));

const requestId = "12345678-abcd-4000-8000-123456789012";
const otherTabRequestId = "87654321-abcd-4000-8000-123456789012";
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
const assign = vi.fn();

function elements(node: ReactNode): Array<Record<string, unknown>> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [{ ...child.props, elementType: child.type }, ...elements(child.props.children)];
  });
}
function render() {
  harness.cursor = 0;
  return CartPage({ added: false, checkoutCancelled: false, previewMode: false, catalogPrices: [] });
}
function cart() {
  return { version: 1 as const, requestId, productId: "test-product", productName: "テスト商品", unitAmount: 4000, quantity: 1,
    recipientName: "テスト", giftMessage: "テスト", deliveryDate: getEarliestDeliveryDate() };
}
async function submitCart(result: unknown) {
  actions.create.mockResolvedValue(result);
  render();
  if (!harness.action) throw new Error("Missing purchase action");
  const formData = new FormData();
  formData.set("requestId", requestId);
  return harness.action({}, formData);
}

beforeEach(() => {
  harness.values = []; harness.cursor = 0; harness.action = null;
  actions.create.mockReset(); assign.mockReset(); values.clear();
  vi.stubGlobal("window", { sessionStorage: storage, dispatchEvent: vi.fn(), location: { assign } });
  storeCart(storage, cart());
});
afterEach(() => vi.unstubAllGlobals());

describe("pressing checkout again for a purchase that already ended", () => {
  it("keeps the gift and gives the next attempt a new request", async () => {
    const result = { restart: true, error: giftExperienceContent.cart.checkoutRestartRequired };
    await expect(submitCart(result)).resolves.toEqual(result);
    const saved = readRecoverableCart(storage);
    expect(saved?.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(saved?.requestId).not.toBe(requestId);
    expect(saved).toMatchObject({ productId: "test-product", recipientName: "テスト", giftMessage: "テスト", quantity: 1 });
    expect(assign).not.toHaveBeenCalled();
  });

  it("clears a cart whose checkout was already completed and says why", async () => {
    await expect(submitCart({ completed: true })).resolves.toEqual({ completed: true });
    expect(readRecoverableCart(storage)).toBeNull();
    const tree = render();
    expect(elements(tree).some((item) => item.role === "status" && item.children === giftExperienceContent.cart.orderAlreadyCompleted)).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    { restart: true, error: giftExperienceContent.cart.checkoutRestartRequired },
    { completed: true },
  ])("never rewrites or clears a cart another tab replaced: %j", async (result) => {
    storeCart(storage, { ...cart(), requestId: otherTabRequestId, recipientName: "別タブ" });
    await expect(submitCart(result)).resolves.toEqual({ error: new CartChangedError().message });
    expect(readRecoverableCart(storage)).toMatchObject({ requestId: otherTabRequestId, recipientName: "別タブ" });
  });

  it("leaves the cart and its request untouched for an ordinary business error", async () => {
    await expect(submitCart({ error: "在庫が不足しています。" })).resolves.toEqual({ error: "在庫が不足しています。" });
    expect(readRecoverableCart(storage)?.requestId).toBe(requestId);
  });
});
