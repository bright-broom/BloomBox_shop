import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ customer: vi.fn(), operator: vi.fn(), account: vi.fn(), guard: vi.fn(), catalog: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("./auth-entry", () => ({ loadCustomerEntry: mocks.customer, loadOperatorEntry: mocks.operator, requireOperatorLogin: mocks.guard }));
vi.mock("../customer-account", () => ({ loadCustomerAccount: mocks.account }));
vi.mock("./operator-auth/native-catalog-management", () => ({ readManagedCatalog: mocks.catalog }));
vi.mock("@/app/account/actions", () => ({ startCustomerLogin: vi.fn(), endCustomerLogin: vi.fn() }));
vi.mock("@/app/operations/actions", () => ({ startOperatorLogin: vi.fn(), endOperatorLogin: vi.fn() }));
import CustomerLogin from "@/app/account/login/page";
import OperatorLogin from "@/app/operations/login/page";
import Account from "@/app/account/page";
import Operations from "@/app/operations/page";
import Catalog from "@/app/operations/catalog/page";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "preview"); });
afterEach(() => vi.unstubAllEnvs());
describe("dedicated login and destination pages", () => {
  it.each(["disabled", "signed-out", "expired"])("sends %s customers from My Page to customer login", async (status) => {
    mocks.account.mockResolvedValue({ status });
    await expect(Account({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/account/login");
  });
  it("keeps a ready customer on their real account even when purchase history is empty", async () => {
    mocks.account.mockResolvedValue({ status: "ready", account: { name: "本人", email: "fixture@example.test", orders: [], nextCursor: null } });
    const html = renderToStaticMarkup(await Account({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("まだ、ご注文はありません"); expect(html).not.toContain("SAMPLE-");
  });
  it("shows a distinct preview link only outside production, with no fake sign-in", async () => {
    mocks.customer.mockResolvedValue({ status: "disabled" });
    const html = renderToStaticMarkup(await CustomerLogin({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("/preview/account"); expect(html).not.toContain("<form");
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "production");
    expect(renderToStaticMarkup(await CustomerLogin({ searchParams: Promise.resolve({}) }))).not.toContain("/preview/account");
  });
  it("skips customer login only after verification and preserves an allowed destination", async () => {
    mocks.customer.mockResolvedValue({ status: "ready" });
    await expect(CustomerLogin({ searchParams: Promise.resolve({ next: "/operations" }) })).rejects.toThrow("redirect:/account");
    const next = "/account/orders/12345678-abcd-4000-8000-123456789012";
    await expect(CustomerLogin({ searchParams: Promise.resolve({ next }) })).rejects.toThrow(`redirect:${next}`);
  });
  it("does not send unregistered operators into a login loop or grant them management access", async () => {
    mocks.operator.mockResolvedValue({ status: "ready", subject: "verified_subject", bound: false });
    await expect(Operations()).rejects.toThrow("redirect:/operations/login");
    const html = renderToStaticMarkup(await OperatorLogin({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("担当者登録の確認が必要"); expect(html).not.toContain('href="/operations/catalog"');
  });
  it("opens the management hub for registered operators and keeps role enforcement before data access", async () => {
    mocks.operator.mockResolvedValue({ status: "ready", subject: "verified", bound: true });
    await expect(OperatorLogin({ searchParams: Promise.resolve({ next: "/operations/catalog" }) })).rejects.toThrow("redirect:/operations/catalog");
    const html = renderToStaticMarkup(await Operations());
    for (const path of ["catalog", "customers", "permissions", "fulfillments"]) expect(html).toContain(`/operations/${path}`);
    mocks.guard.mockRejectedValue(new Error("redirect:/operations/login"));
    await expect(Catalog({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:");
    expect(mocks.catalog).not.toHaveBeenCalled();
    mocks.guard.mockResolvedValue(undefined);
    mocks.catalog.mockResolvedValue({ products: [], stock: [], next: null });
    await Catalog({ searchParams: Promise.resolve({}) });
    expect(mocks.guard.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.catalog.mock.invocationCallOrder[0]);
  });
});
