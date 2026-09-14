vi.mock("@/shared/infrastructure/security/auth-entry", () => ({ requireOperatorLogin: vi.fn(async () => undefined) }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "@/app/operations/fulfillments/page";
import { FulfillmentReviewError, type FulfillmentInbox } from "@/modules/fulfillment/public";
import { fulfillmentInboxContent as copy } from "../../content/fulfillment-inbox-content";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./read-operator-inbox", () => ({ readOperatorInbox: mocks.read }));
const fixture: FulfillmentInbox = {
  shop: "example.myshopify.com", testMode: true, viewedAt: "2026-09-12T00:00:00Z", nextCursor: "cursor_for_next_page",
  entries: [{ fulfillmentId: "00000000-0000-4000-8000-000000000001", reference: "123456", totalMinor: 5000, deliveryDate: "2026-09-20", status: "UNFULFILLED" }],
};
beforeEach(() => vi.resetAllMocks());
describe("operator inbox page", () => {
  it("offers a labeled GET search without querying when no shop is selected", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('method="get"'); expect(html).toContain('for="operator-shop"');
    expect(html).toContain('aria-describedby="operator-shop-hint"'); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("renders permitted links and pagination with the same shop and honest saved-status wording", async () => {
    mocks.read.mockResolvedValue(fixture);
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ shop: fixture.shop, cursor: "current_cursor" }) }));
    expect(mocks.read).toHaveBeenCalledWith({ shop: fixture.shop, cursor: "current_cursor" });
    expect(html).toContain(`/operations/fulfillments/${fixture.shop}/${fixture.entries[0].fulfillmentId}`);
    expect(html).toContain(`shop=${fixture.shop}&amp;cursor=${fixture.nextCursor}`);
    expect(html).toContain(copy.testMode); expect(html).toContain(copy.listNote); expect(html).toContain("￥5,000");
    expect(html).not.toMatch(/recipient|address|ciphertext|token|operatorId/);
  });
  it("shows empty and final-page results without a dead next-page control", async () => {
    mocks.read.mockResolvedValue({ ...fixture, testMode: false, entries: [], nextCursor: null });
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ shop: fixture.shop }) }));
    expect(html).toContain(copy.empty); expect(html).toContain(copy.liveMode); expect(html).not.toContain(copy.next);
  });
  it.each(["INVALID_REQUEST", "NOT_AUTHORIZED", "UNAVAILABLE"] as const)("shows a safe %s state without an order link", async (code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.read.mockRejectedValue(new FulfillmentReviewError(code));
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ shop: fixture.shop }) }));
    expect(html).toContain('role="alert"'); expect(html).not.toContain(fixture.entries[0].fulfillmentId);
    expect(html).toContain(code === "INVALID_REQUEST" ? copy.invalid : code === "NOT_AUTHORIZED" ? copy.denied : copy.unavailable);
    log.mockRestore();
  });
  it("rejects duplicated query parameters and hides unexpected diagnostics", async () => {
    const bad = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ shop: [fixture.shop, "other.myshopify.com"] }) }));
    expect(bad).toContain(copy.invalid); expect(mocks.read).not.toHaveBeenCalled();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.read.mockRejectedValue(new Error("PRIVATE_DATABASE_CREDENTIAL"));
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ shop: fixture.shop }) }));
    expect(html).toContain(copy.unavailable); expect(html).not.toContain("PRIVATE_DATABASE_CREDENTIAL");
    expect(log).toHaveBeenCalledWith("operator_inbox_unavailable"); log.mockRestore();
  });
});
