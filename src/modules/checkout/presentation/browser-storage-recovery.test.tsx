import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { money } from "@/shared/domain/money";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import { CartPage } from "@/ui/cart-page";
import { GiftForm } from "@/ui/gift-form";
import { HeaderCartLink } from "@/ui/header-cart-link";
import { PreviewBuyerForm } from "@/ui/preview-buyer-form";
import { PreviewOrderReview } from "@/ui/preview-order-review";
import { PreviewPayment } from "@/ui/preview-payment";
import { PreviewCheckoutComplete } from "@/ui/preview-checkout-complete";
import {
  CHECKOUT_SESSION_UNAVAILABLE,
  readBrowserCartQuantity,
  readBrowserCheckoutSessionSnapshot,
} from "./browser-checkout-session";

// Read the client snapshot during server rendering to test the unavailable branch without a browser.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useActionState: () => [{}, vi.fn(), false],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./actions", () => ({ createPurchaseIntentAction: vi.fn() }));
vi.mock("./preview-referral-actions", () => ({ quotePreviewReferralAction: vi.fn(), settlePreviewReferralAction: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

function deniedStorage(mode: "property" | "getItem") {
  const storage = {
    getItem: vi.fn(() => { throw new DOMException("private-read-detail", "SecurityError"); }),
    setItem: vi.fn(), removeItem: vi.fn(),
  };
  vi.stubGlobal("window", mode === "property" ? {
    get sessionStorage() { throw new DOMException("private-property-detail", "SecurityError"); },
  } : { sessionStorage: storage });
  return storage;
}

describe.each(["property", "getItem"] as const)("denied storage %s", (mode) => {
  it("reports an unavailable snapshot and unknown cart count without writes", () => {
    const storage = deniedStorage(mode);
    expect(readBrowserCheckoutSessionSnapshot()).toBe(CHECKOUT_SESSION_UNAVAILABLE);
    expect(readBrowserCheckoutSessionSnapshot()).toBe(CHECKOUT_SESSION_UNAVAILABLE);
    expect(readBrowserCartQuantity()).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    ["gift", <GiftForm key="GiftForm" productId="test" productName="Test" unitPrice={money(4000)} minDeliveryDate="2026-09-15" maxDeliveryDate="2026-11-11" />],
    ["cart", <CartPage key="CartPage" added={false} checkoutCancelled={false} previewMode previewPrices={[]} />],
    ["buyer", <PreviewBuyerForm key="PreviewBuyerForm" enabled />],
    ["review", <PreviewOrderReview key="PreviewOrderReview" enabled />],
    ["payment", <PreviewPayment key="PreviewPayment" enabled />],
    ["receipt", <PreviewCheckoutComplete key="PreviewCheckoutComplete" enabled />],
  ])("shows recovery instead of empty or completed state on %s", (_name, page) => {
    const storage = deniedStorage(mode);
    const html = renderToStaticMarkup(page);
    expect(html).toContain(giftExperienceContent.storageUnavailable.title);
    expect(html).toContain('role="alert"');
    expect(html).toContain(giftExperienceContent.storageUnavailable.retry);
    expect(html).toContain('href="/flowers"');
    expect(html).not.toContain("カートは空です");
    expect(html).not.toContain("注文が<br/>完了しました");
    expect(html).not.toContain("private-");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

it("recovers on the next read and distinguishes an empty readable cart", () => {
  let denied = true;
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal("window", { get sessionStorage() {
    if (denied) throw new DOMException("denied", "SecurityError");
    return storage;
  } });
  expect(readBrowserCheckoutSessionSnapshot()).toBe(CHECKOUT_SESSION_UNAVAILABLE);
  denied = false;
  const readable = readBrowserCheckoutSessionSnapshot();
  expect(readable).not.toBe(CHECKOUT_SESSION_UNAVAILABLE);
  expect(readBrowserCheckoutSessionSnapshot()).toBe(readable);
  expect(readBrowserCartQuantity()).toBe(0);
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.removeItem).not.toHaveBeenCalled();
});

it("does not announce zero items while the header count is unknown", () => {
  expect(renderToStaticMarkup(<HeaderCartLink />)).toContain("カート、件数を確認できません");
});
