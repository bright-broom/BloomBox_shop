import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogManagementError } from "@/modules/catalog/public";
import CatalogHistory from "./page";
const mocks = vi.hoisted(() => ({ login: vi.fn(), read: vi.fn(), notFound: vi.fn() }));
vi.mock("@/shared/infrastructure/security/auth-entry", () => ({ requireOperatorLogin: mocks.login }));
vi.mock("@/shared/infrastructure/security/operator-auth/native-catalog-management", () => ({ readManagedCatalogHistory: mocks.read }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(null); mocks.notFound.mockImplementation(() => { throw new Error("not-found"); }); });
const productId = "00000000-0000-4000-8000-000000000001";
describe("catalog history route", () => {
  it("requires operator login before loading a bounded product history", async () => {
    await CatalogHistory({ searchParams: Promise.resolve({ productId, kind: "stock", before: "12" }) });
    expect(mocks.login).toHaveBeenCalledWith("/operations/catalog/history");
    expect(mocks.read).toHaveBeenCalledWith({ productId, kind: "stock", before: 12 });
    expect(mocks.login.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[0]);
  });
  it.each([{ productId: [productId, productId] }, { productId: "bad" }, { productId, kind: "all" }, { productId, before: "0" }, { productId, before: "9007199254740992" }, { operatorId: productId }, { before: "10" }])("rejects invalid search params %j without querying records", async (search) => {
    const html = renderToStaticMarkup(await CatalogHistory({ searchParams: Promise.resolve(search) }));
    expect(html).toContain("商品IDとページ指定を確認してください");
    expect(mocks.read).toHaveBeenCalledWith({ kind: "catalog" });
  });
  it("denies the history page to an operator without a current catalog grant", async () => {
    mocks.read.mockRejectedValue(new CatalogManagementError("DENIED"));
    await expect(CatalogHistory({ searchParams: Promise.resolve({productId}) })).rejects.toThrow("not-found");
  });
  it("offers an error state rather than an empty history during a database outage", async () => {
    mocks.read.mockRejectedValue(new CatalogManagementError("UNAVAILABLE"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const html = renderToStaticMarkup(await CatalogHistory({ searchParams: Promise.resolve({productId}) }));
      expect(html).toContain('role="alert"'); expect(html).toContain("履歴を読み込めませんでした");
      expect(html).not.toContain("条件に一致する変更履歴はありません");
      expect(logged).toHaveBeenCalledWith("native_catalog_history_read_unavailable");
    } finally { logged.mockRestore(); }
  });
});
