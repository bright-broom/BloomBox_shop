import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GiftForm } from "./gift-form";
import { money } from "@/shared/domain/money";
import { getEarliestDeliveryDate, getLatestDeliveryDate } from "@/modules/fulfillment/public";
import {
  CartChangedError,
  readRecoverableCart,
  storeCart,
  type BrowserCartItem,
} from "@/modules/checkout/presentation/browser-checkout-session";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";

const harness = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, push: vi.fn(), cancel: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (index >= harness.values.length) harness.values.push(initial);
    return [harness.values[index], (next: unknown) => { harness.values[index] = next; }];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: harness.push }) }));
vi.mock("@/modules/checkout/presentation/actions", () => ({ cancelPurchaseIntentAction: harness.cancel }));
vi.mock("@/ui/use-checkout-session-revision", async (original) => ({
  ...await original<typeof import("@/ui/use-checkout-session-revision")>(),
  useCheckoutSessionRevision: () => "test",
}));

const sizeOptions = [
  { id: "prod_bloombox_m", name: "BLOOM BOX M", size: "M" as const, price: money(4000), shippingAmount: 1000 },
  { id: "prod_bloombox_l", name: "BLOOM BOX L", size: "L" as const, price: money(8000), shippingAmount: 0 },
];
const previousRequestId = "12345678-abcd-4000-8000-123456789012";
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
const fields = new Map<string, string>();

function previousCart(): BrowserCartItem {
  return {
    version: 1, requestId: previousRequestId, productId: "prod_bloombox_l", productName: "BLOOM BOX L", unitAmount: 8000,
    quantity: 1, recipientName: "前の宛名", deliveryDate: getEarliestDeliveryDate(new Date()), giftMessage: "前のことば",
  };
}
function elements(node: ReactNode): Array<Record<string, unknown>> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [{ ...child.props, elementType: child.type }, ...elements(child.props.children)];
  });
}
/** GiftForm returns the configuration form element; call it with the mocked hooks to inspect its tree. */
function render(previewMode = false): ReactNode {
  harness.cursor = 0;
  const now = new Date();
  const outer = GiftForm({ productId: "prod_bloombox_m", productName: "BLOOM BOX M", unitPrice: money(4000), sizeOptions,
    minDeliveryDate: getEarliestDeliveryDate(now), maxDeliveryDate: getLatestDeliveryDate(now), previewMode });
  if (!isValidElement(outer) || typeof outer.type !== "function") throw new Error("Expected the configuration form element");
  return (outer.type as (props: unknown) => ReactNode)(outer.props);
}
function submit(tree: ReactNode): Promise<void> {
  const form = elements(tree).find((item) => item.elementType === "form");
  if (!form || typeof form.onSubmit !== "function") throw new Error("Missing gift form");
  return (form.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn(), currentTarget: { elements: { namedItem: () => null } } });
}
function alertText(tree: ReactNode) {
  return elements(tree).find((item) => item.role === "alert" && typeof item.children === "string")?.children;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  harness.values = []; harness.cursor = 0; harness.push.mockReset(); harness.cancel.mockReset();
  values.clear();
  fields.clear();
  for (const [key, value] of Object.entries({ productId: "prod_bloombox_m", quantity: "1", recipientName: "新しい宛名",
    deliveryDate: getEarliestDeliveryDate(new Date()), giftMessage: "新しいことば" })) fields.set(key, value);
  vi.stubGlobal("window", { sessionStorage: storage, dispatchEvent: vi.fn() });
  vi.stubGlobal("FormData", class { get(key: string) { return fields.get(key) ?? null; } });
});
afterEach(() => vi.unstubAllGlobals());

describe("saving a gift over an existing production cart", () => {
  it("cancels the purchase the previous cart prepared before replacing that cart", async () => {
    storeCart(storage, previousCart());
    const pendingCancel = deferred<{ status: "cancelled" }>();
    harness.cancel.mockReturnValue(pendingCancel.promise);
    const saving = submit(render());
    expect(harness.cancel).toHaveBeenCalledExactlyOnceWith(previousRequestId);
    expect(readRecoverableCart(storage)?.requestId).toBe(previousRequestId);
    expect(elements(render()).find((item) => item.elementType === "button" && item.type === "submit")?.disabled).toBe(true);
    expect(harness.push).not.toHaveBeenCalled();
    pendingCancel.resolve({ status: "cancelled" });
    await saving;
    const saved = readRecoverableCart(storage);
    expect(saved?.requestId).not.toBe(previousRequestId);
    expect(saved).toMatchObject({ productId: "prod_bloombox_m", recipientName: "新しい宛名", giftMessage: "新しいことば" });
    expect(harness.push).toHaveBeenCalledExactlyOnceWith("/cart?added=1");
  });

  it("stores the new gift when the previous cart never prepared a purchase", async () => {
    storeCart(storage, previousCart());
    harness.cancel.mockResolvedValue({ status: "not_prepared" });
    await submit(render());
    expect(readRecoverableCart(storage)?.recipientName).toBe("新しい宛名");
    expect(harness.push).toHaveBeenCalledExactlyOnceWith("/cart?added=1");
  });

  it("keeps the previous cart and explains why when the server refuses the cancellation", async () => {
    storeCart(storage, previousCart());
    harness.cancel.mockResolvedValue({ error: "決済手続きが始まっているため、この購入準備を取り消せません。" });
    await submit(render());
    expect(readRecoverableCart(storage)).toMatchObject({ requestId: previousRequestId, recipientName: "前の宛名" });
    expect(harness.push).not.toHaveBeenCalled();
    const tree = render();
    expect(alertText(tree)).toContain("取り消せません");
    expect(elements(tree).find((item) => item.elementType === "button" && item.type === "submit")?.disabled).toBe(false);
  });

  it("keeps the previous cart when the cancellation request cannot be reached", async () => {
    storeCart(storage, previousCart());
    harness.cancel.mockRejectedValue(new Error("private network detail"));
    await submit(render());
    expect(readRecoverableCart(storage)?.requestId).toBe(previousRequestId);
    expect(alertText(render())).toBe(giftExperienceContent.cart.cancelFailed);
    expect(harness.push).not.toHaveBeenCalled();
  });

  it("saves the new gift but tells the cart that a completed checkout was not cancelled", async () => {
    storeCart(storage, previousCart());
    harness.cancel.mockResolvedValue({ status: "completed" });
    await submit(render());
    expect(readRecoverableCart(storage)?.recipientName).toBe("新しい宛名");
    expect(harness.push).toHaveBeenCalledExactlyOnceWith("/cart?added=1&previous=completed");
  });

  it("does not overwrite a cart that another tab replaced while cancellation was pending", async () => {
    storeCart(storage, previousCart());
    const pendingCancel = deferred<{ status: "cancelled" }>();
    harness.cancel.mockReturnValue(pendingCancel.promise);
    const saving = submit(render());
    const otherTabRequestId = "87654321-abcd-4000-8000-123456789012";
    storeCart(storage, { ...previousCart(), requestId: otherTabRequestId, recipientName: "別タブの宛名" });
    pendingCancel.resolve({ status: "cancelled" });
    await saving;
    expect(readRecoverableCart(storage)).toMatchObject({ requestId: otherTabRequestId, recipientName: "別タブの宛名" });
    expect(alertText(render())).toBe(new CartChangedError().message);
    expect(harness.push).not.toHaveBeenCalled();
  });
});

describe("saving a gift without a production purchase to close", () => {
  it("keeps preview replacement local", async () => {
    storeCart(storage, previousCart());
    await submit(render(true));
    expect(harness.cancel).not.toHaveBeenCalled();
    expect(readRecoverableCart(storage)?.recipientName).toBe("新しい宛名");
    expect(harness.push).toHaveBeenCalledExactlyOnceWith("/cart?added=1");
  });

  it("does not call the server for a first gift", async () => {
    await submit(render());
    expect(harness.cancel).not.toHaveBeenCalled();
    expect(readRecoverableCart(storage)?.recipientName).toBe("新しい宛名");
    expect(harness.push).toHaveBeenCalledExactlyOnceWith("/cart?added=1");
  });
});
