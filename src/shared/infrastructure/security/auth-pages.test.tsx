import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ customer: vi.fn(), operator: vi.fn(), account: vi.fn(), guard: vi.fn(), catalog: vi.fn(), orders: vi.fn(), report: vi.fn(), agreement: vi.fn(), portal: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("./auth-entry", () => ({ loadCustomerEntry: mocks.customer, loadOperatorEntry: mocks.operator, requireOperatorLogin: mocks.guard }));
vi.mock("./operator-auth/operations-console", () => ({ openOperatorOrders: mocks.orders, openOperatorReport: mocks.report }));
vi.mock("../customer-portal", () => ({ loadCustomerPortal: mocks.portal, loadMembershipAgreement: mocks.agreement, loadCustomerRequests: vi.fn() }));
vi.mock("../customer-account", () => ({ loadCustomerAccount: mocks.account }));
vi.mock("./operator-auth/native-catalog-management", () => ({ readManagedCatalog: mocks.catalog }));
vi.mock("@/app/account/actions", () => ({ startCustomerLogin: vi.fn(), endCustomerLogin: vi.fn(), startCustomerRegistration: vi.fn(), agreeToMembership: vi.fn() }));
vi.mock("@/app/account/portal-actions", () => ({ saveAccountPreferences: vi.fn(), sendAccountRequest: vi.fn(), endAllCustomerSessions: vi.fn() }));
vi.mock("@/shared/infrastructure/composition-root", () => ({ application: { getProduct: { byId: vi.fn() }, listProducts: { execute: vi.fn() } } }));
vi.mock("@/app/operations/actions", () => ({ startOperatorLogin: vi.fn(), endOperatorLogin: vi.fn() }));
import CustomerLogin from "@/app/account/login/page";
import OperatorLogin from "@/app/operations/login/page";
import Account from "@/app/account/page";
import Register from "@/app/account/register/page";
import Welcome from "@/app/account/welcome/page";
import AccountSection from "@/app/account/[section]/page";
import Operations from "@/app/operations/page";
import Catalog from "@/app/operations/catalog/page";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "preview"); mocks.agreement.mockResolvedValue({ status: "signed-out" }); mocks.portal.mockResolvedValue({ status: "unavailable" }); });
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
  it("offers registration from login and explains what Google provides before sign-up", async () => {
    mocks.customer.mockResolvedValue({ status: "signed-out" });
    expect(renderToStaticMarkup(await CustomerLogin({ searchParams: Promise.resolve({}) }))).toContain('href="/account/register"');
    const html = renderToStaticMarkup(await Register({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("新規会員登録"); expect(html).toContain("Googleで登録する");
    expect(html).toContain("確認済みのメールアドレス"); expect(html).toContain('href="/account/login"');
    mocks.customer.mockResolvedValue({ status: "ready" });
    await expect(Register({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/account");
  });
  it("sends a member without the current agreement to the agreement step before any account data", async () => {
    mocks.agreement.mockResolvedValue({ status: "ready", agreement: { status: "required", version: "v2", previousVersion: null } });
    await expect(Account({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/account/welcome");
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it("asks for an explicit, versioned agreement with the documents linked, and skips it once agreed", async () => {
    mocks.agreement.mockResolvedValue({ status: "ready", agreement: { status: "required", version: "2026-09-19-draft", previousVersion: null } });
    const html = renderToStaticMarkup(await Welcome({ searchParams: Promise.resolve({ next: "/account/profile" }) }));
    expect(html).toContain('href="/terms"'); expect(html).toContain('href="/privacy"');
    expect(html).toMatch(/<input type="checkbox" required="" name="agree"\/>/);
    expect(html).toContain('name="version" value="2026-09-19-draft"'); expect(html).toContain('name="next" value="/account/profile"');
    expect(html).toContain("同意して登録を完了する"); expect(html).toContain("同意せずにログアウトする");
    mocks.agreement.mockResolvedValue({ status: "ready", agreement: { status: "required", version: "v2", previousVersion: "v1" } });
    expect(renderToStaticMarkup(await Welcome({ searchParams: Promise.resolve({ error: "invalid" }) }))).toContain("改定しました");
    mocks.agreement.mockResolvedValue({ status: "ready", agreement: { status: "agreed", version: "v2" } });
    await expect(Welcome({ searchParams: Promise.resolve({ next: "https://evil.example" }) })).rejects.toThrow("redirect:/account");
    mocks.agreement.mockResolvedValue({ status: "signed-out" });
    await expect(Welcome({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/account/login?next=%2Faccount%2Fwelcome");
  });
  it("keeps the product a signed-out visitor wanted to favorite through login and the agreement step", async () => {
    const add = "prod_bloombox_m";
    const next = `/account/favorites?add=${add}`;
    const open = (section: string, params: Record<string, string> = { add }) =>
      AccountSection({ params: Promise.resolve({ section }), searchParams: Promise.resolve(params) });
    mocks.portal.mockResolvedValue({ status: "signed-out" });
    await expect(open("favorites")).rejects.toThrow(`redirect:/account/login?next=${encodeURIComponent(next)}`);
    // A member who has not agreed yet returns to the same product after agreeing.
    mocks.agreement.mockResolvedValue({ status: "ready", agreement: { status: "required", version: "v1", previousVersion: null } });
    await expect(open("favorites")).rejects.toThrow(`redirect:/account/welcome?next=${encodeURIComponent(next)}`);
    mocks.agreement.mockResolvedValue({ status: "signed-out" });
    // Other sections and forged values keep their plain destination.
    await expect(open("profile")).rejects.toThrow("redirect:/account/login?next=%2Faccount%2Fprofile");
    await expect(open("favorites", { add: "https://evil.example" })).rejects.toThrow("redirect:/account/login");
  });
  it("does not send unregistered operators into a login loop or grant them management access", async () => {
    mocks.operator.mockResolvedValue({ status: "ready", subject: "verified_subject", bound: false });
    await expect(OperatorLogin({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/operations");
    const html = renderToStaticMarkup(await Operations());
    expect(html).toContain("担当者登録が必要");
    expect(mocks.orders).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
  });
  it("opens the management hub for registered operators and keeps role enforcement before data access", async () => {
    mocks.operator.mockResolvedValue({ status: "ready", subject: "verified", bound: true });
    await expect(OperatorLogin({ searchParams: Promise.resolve({ next: "/operations/catalog" }) })).rejects.toThrow("redirect:/operations/catalog");
    mocks.orders.mockResolvedValue({ orders: [], next: null });
    mocks.report.mockResolvedValue({ days: 30, orders: 0, orderValueYen: 0, captured: 0, refunds: 0, awaitingShipment: 0, cancelled: 0, daily: [], since: new Date().toISOString(), until: new Date().toISOString() });
    const html = renderToStaticMarkup(await Operations());
    for (const path of ["catalog", "customers", "orders", "settings"]) expect(html).toContain(`/operations/${path}`);
    mocks.guard.mockRejectedValue(new Error("redirect:/operations/login"));
    await expect(Catalog({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:");
    expect(mocks.catalog).not.toHaveBeenCalled();
    mocks.guard.mockResolvedValue(undefined);
    mocks.catalog.mockResolvedValue({ products: [], stock: [], next: null });
    await Catalog({ searchParams: Promise.resolve({}) });
    expect(mocks.guard.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.catalog.mock.invocationCallOrder[0]);
  });
});
