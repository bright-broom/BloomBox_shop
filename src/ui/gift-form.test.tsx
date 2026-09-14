import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GiftForm } from "./gift-form";
import { money } from "@/shared/domain/money";
import { getEarliestDeliveryDate, getLatestDeliveryDate } from "@/modules/fulfillment/public";
import { storeCart, type BrowserCartItem } from "@/modules/checkout/presentation/browser-checkout-session";

// Exercise the hydrated form with the real storage reader, as in the storage recovery tests.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/modules/checkout/presentation/actions", () => ({ cancelPurchaseIntentAction: vi.fn() }));

const sizeOptions = [
  { id: "prod_bloombox_m", name: "BLOOM BOX M", size: "M" as const, price: money(4000), shippingAmount: 1000 },
  { id: "prod_bloombox_l", name: "BLOOM BOX L", size: "L" as const, price: money(8000), shippingAmount: 0 },
];
const savedCart: BrowserCartItem = {
  version: 1, requestId: "12345678-abcd-4000-8000-123456789012",
  productId: "prod_bloombox_l", productName: "BLOOM BOX L", unitAmount: 8000, quantity: 1,
  recipientName: "確認用の宛名", deliveryDate: "2026-09-22", giftMessage: "お誕生日おめでとう",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T03:00:00Z"));
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
    dispatchEvent: vi.fn(),
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function renderGift() {
  const now = new Date();
  return renderToStaticMarkup(<GiftForm productId="prod_bloombox_m" productName="BLOOM BOX M"
    unitPrice={money(4000)} sizeOptions={sizeOptions}
    minDeliveryDate={getEarliestDeliveryDate(now)} maxDeliveryDate={getLatestDeliveryDate(now)} />);
}
function dateInput(html: string) {
  return html.match(/<input[^>]*name="deliveryDate"[^>]*>/)?.[0];
}

describe("gift form defaults", () => {
  it.each([
    ["2026-09-13T14:59:59Z", "2026-09-16"],
    ["2026-09-13T15:00:00Z", "2026-09-17"],
    ["2026-09-29T03:00:00Z", "2026-10-02"],
    ["2026-12-30T03:00:00Z", "2027-01-02"],
  ])("prefills the first allowed Tokyo delivery day at %s", (now, expected) => {
    vi.setSystemTime(new Date(now));
    const html = renderGift();
    expect(dateInput(html)).toContain(`value="${expected}"`);
    expect(dateInput(html)).toContain(`min="${expected}"`);
    expect(html).toMatch(/<textarea[^>]*>いつもありがとう<\/textarea>/);
    expect(html).toContain('id="giftMessage-count">8 / 180 文字');
    expect(html).toContain('<option value="1" selected="">1 点</option>');
    expect(html.match(/<input[^>]*name="recipientName"[^>]*>/)?.[0]).toContain('value=""');
  });

  it("keeps the recipient, chosen date and words when editing the same size family", () => {
    storeCart(window.sessionStorage, savedCart);
    const html = renderGift();
    expect(dateInput(html)).toContain('value="2026-09-22"');
    expect(html).toMatch(/<textarea[^>]*>お誕生日おめでとう<\/textarea>/);
    expect(html).toContain('value="確認用の宛名"');
  });

  it("keeps an expired saved date visible with its correction notice instead of silently changing it", () => {
    storeCart(window.sessionStorage, savedCart);
    vi.setSystemTime(new Date("2026-09-25T03:00:00Z"));
    const html = renderGift();
    expect(dateInput(html)).toContain('value="2026-09-22"');
    expect(html).toContain("お届け希望日が期限外になっています");
  });

  it("uses new defaults when replacing another product and still requires replacement acceptance", () => {
    storeCart(window.sessionStorage, { ...savedCart, productId: "other-product" });
    const html = renderGift();
    expect(dateInput(html)).toContain('value="2026-09-16"');
    expect(html).toMatch(/<textarea[^>]*>いつもありがとう<\/textarea>/);
    expect(html).not.toContain('value="確認用の宛名"');
    expect(html).toContain("今のギフトをこの花に入れ替える");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
});
