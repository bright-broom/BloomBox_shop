import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewBuyerForm } from "@/ui/preview-buyer-form";
import { PreviewOrderReview } from "@/ui/preview-order-review";

const harness = vi.hoisted(() => ({
  values: [] as unknown[], cursor: 0, push: vi.fn(), saveBuyer: vi.fn(), saveReview: vi.fn(),
}));
// Exercise the actual submit handlers and their re-rendered error states without a DOM dependency.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (index >= harness.values.length) harness.values.push(initial);
    return [harness.values[index], (next: unknown) => {
      harness.values[index] = typeof next === "function" ? next(harness.values[index]) : next;
    }];
  },
  useEffect: () => undefined,
  useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: harness.push }) }));
vi.mock("@/ui/use-checkout-session-revision", () => ({ useCheckoutSessionRevision: () => "test" }));
vi.mock("@/modules/checkout/presentation/browser-checkout-session", async (original) => ({
  ...await original<typeof import("@/modules/checkout/presentation/browser-checkout-session")>(),
  readCart: () => ({ productId: "test-product", recipientName: "テスト", deliveryDate: "2026-10-01", giftMessage: "テスト" }),
  readPreviewBuyer: () => ({ buyerName: "テスト", postalCode: "", email: "test@example.com" }),
  readPreviewDraft: () => ({ productName: "テスト商品", quantity: 1, subtotalAmount: 4000, shippingAmount: 1000 }),
  storePreviewBuyer: harness.saveBuyer,
  acceptPreviewReview: harness.saveReview,
}));

function elements(node: ReactNode): Array<Record<string, unknown>> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [{ ...child.props, elementType: child.type }, ...elements(child.props.children)];
  });
}

function renderBuyer(): ReactNode {
  harness.cursor = 0;
  const child = PreviewBuyerForm({ enabled: true });
  if (typeof child.type !== "function") throw new Error("Expected buyer form");
  // The wrapper returns the function component containing the form; no class component is used here.
  const Form = child.type as (props: unknown) => ReactNode;
  return Form(child.props);
}
function renderReview(): ReactNode {
  harness.cursor = 0;
  return PreviewOrderReview({ enabled: true });
}
function submit(tree: ReactNode) {
  const handler = elements(tree).find((element) => element.elementType === "form")?.onSubmit;
  if (typeof handler !== "function") throw new Error("Expected submit handler");
  handler({ preventDefault: vi.fn(), currentTarget: {} });
}
function alerts(tree: ReactNode) {
  return elements(tree).filter((element) => element.role === "alert").map((element) => element.children);
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.saveBuyer.mockReset(); harness.saveReview.mockReset();
  harness.values = []; harness.cursor = 0;
  vi.stubGlobal("window", { sessionStorage: {} });
  vi.stubGlobal("FormData", class extends Map<string, string> {
    constructor() {
      super(Object.entries({ buyerName: "テスト", email: "test@example.com", phone: "09012345678",
        postalCode: "1000001", prefecture: "東京都", city: "テスト市", addressLine1: "テスト番地", addressLine2: "" }));
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe.each([
  { name: "buyer information", render: renderBuyer, save: harness.saveBuyer, destination: "/checkout/test/review" },
  { name: "review confirmation", render: renderReview, save: harness.saveReview, destination: "/checkout/test/payment" },
])("$name save feedback", ({ render, save, destination }) => {
  it.each(["QuotaExceededError", "SecurityError"])("keeps the page and permits retry after %s", (name) => {
    save.mockImplementationOnce(() => { throw new DOMException("private-storage-detail", name); });
    expect(() => submit(render())).not.toThrow();
    expect(harness.push).not.toHaveBeenCalled();
    const errorMessages = alerts(render());
    expect(errorMessages).toHaveLength(1);
    expect(errorMessages[0]).toContain("保存できませんでした");
    expect(errorMessages[0]).not.toContain("private-storage-detail");

    submit(render());
    expect(save).toHaveBeenCalledTimes(2);
    expect(harness.push).toHaveBeenCalledExactlyOnceWith(destination);
    expect(alerts(render())).toEqual([]);
  });

  it("navigates only after a successful save", () => {
    submit(render());
    expect(save).toHaveBeenCalledTimes(1);
    expect(harness.push).toHaveBeenCalledExactlyOnceWith(destination);
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(harness.push.mock.invocationCallOrder[0]);
    expect(alerts(render())).toEqual([]);
  });
});
