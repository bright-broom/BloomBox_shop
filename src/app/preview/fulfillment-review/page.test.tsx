import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "./page";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
afterEach(() => { vi.unstubAllEnvs(); });

describe("fulfillment review preview", () => {
  it("rejects production mode before rendering synthetic order data", async () => {
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "production");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  });
  it.each([
    ["pending", "承認待ち"], ["expired", "在庫の再確認が必要"], ["refund", "決済情報が更新されています"], ["recorded", "承認の記録があります"],
  ])("renders %s honestly without an active approval form", async (state, expected) => {
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "preview");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ state }) }));
    expect(html).toContain(expected); expect(html).toContain("確認内容を記録する");
    if (state === "pending") expect(html).toContain("事業条件の承認設定が完了するまで"); expect(html).toContain("架空の注文");
    expect(html).toContain("aria-current=\"page\"");
    expect(html).not.toMatch(/<form|<button|@gmail|recipient|ciphertext|idempotency/);
    if (state === "refund") expect(html).toContain("￥500");
  });
});
