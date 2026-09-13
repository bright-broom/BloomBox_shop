import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerAccountPanel } from "@/ui/customer-account";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import AccountPreview from "@/app/preview/account/page";
import type { CustomerAccount } from "../public";
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
const account: CustomerAccount = { name: "Synthetic customer", email: "sample@example.test", nextCursor: "next/page=",
  orders: [{ id: "sample", name: "#100", orderedAt: "2026-09-10T22:00:00Z", totalYen: 5000, payment: "PAID", fulfillment: "UNFULFILLED", cancelled: false }] };
afterEach(() => vi.unstubAllEnvs());
describe("native customer account presentation", () => {
  it("renders order and profile data, Japan dates, and a cursor-only pagination link", () => {
    const html = renderToStaticMarkup(<CustomerAccountPanel state={{ status: "ready", account }} />);
    for (const expected of ["#100", "5,000", "2026/09/11", "sample@example.test", "お支払い済み", "未発送", "/account?after=next%2Fpage%3D"]) expect(html).toContain(expected);
    expect(html).not.toContain("customerId="); expect(html).toContain('href="/account/orders/sample"');
  });
  it("escapes customer text and handles unknown/inherited status names without inventing paid state", () => {
    const html = renderToStaticMarkup(<CustomerAccountPanel state={{ status: "ready", account: { ...account, name: "<script>private</script>",
      orders: [{ ...account.orders[0], payment: "__proto__", fulfillment: "constructor", cancelled: true }] } }} />);
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>private");
    expect(html).toContain(copy.cancelled); expect(html).toContain(copy.payments.UNKNOWN); expect(html).not.toContain(copy.payments.PAID);
  });
  it("renders an empty history only for a successfully loaded empty account", () => {
    expect(renderToStaticMarkup(<CustomerAccountPanel state={{ status: "ready", account: { ...account, orders: [] } }} />)).toContain(copy.emptyTitle);
    for (const status of ["disabled", "signed-out", "expired", "unavailable"] as const) {
      const html = renderToStaticMarkup(<CustomerAccountPanel state={{ status }} />);
      expect(html).not.toContain(copy.emptyTitle); expect(html).not.toContain(account.email); expect(html).not.toContain("#100");
      if (status === "expired" || status === "unavailable") expect(html).toContain('role="alert"');
    }
  });
  it("keeps sample accounts explicitly marked, read-only and unavailable in production", async () => {
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "preview");
    const html = renderToStaticMarkup(await AccountPreview({ searchParams: Promise.resolve({ state: "orders" }) }));
    expect(html).toContain(copy.previewNote); expect(html).toContain("#SAMPLE-1002");
    expect(html).toContain("disabled"); expect(html).not.toContain("after=");
    expect(html).toContain("/preview/account/order?sample=sample-1"); expect(html).not.toContain("/account/orders/");
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "production");
    await expect(AccountPreview({ searchParams: Promise.resolve({ state: "orders" }) })).rejects.toThrow("NOT_FOUND");
  });
});
