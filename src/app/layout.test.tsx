import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "./layout";
vi.mock("next/font/google", () => ({ Noto_Sans_JP: () => ({ variable: "fixture-font" }) }));
vi.mock("next/server", () => ({ connection: async () => {} }));
afterEach(() => vi.unstubAllEnvs());
describe("root layout footer across non-selling runtime fixtures", () => {
  it.each([
    {runtime:"preview",checkout:"preview"}, {runtime:"preview",checkout:"stripe"},
    {runtime:"production",checkout:"preview"}, {runtime:"production",checkout:"stripe"},
  ])("preserves essential links and scopes test links in $runtime/$checkout", async ({runtime,checkout}) => {
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE",runtime);
    vi.stubEnv("BLOOMBOX_CHECKOUT_PROVIDER",checkout);
    vi.stubEnv("BLOOMBOX_CHECKOUT_INTAKE_ENABLED","false");
    vi.stubEnv("BLOOMBOX_ADVERTISING_ENABLED","false");
    const html = renderToStaticMarkup(await RootLayout({ children: <h1>表示検証</h1> }));
    const footer = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/)?.[1];
    expect(footer).toBeDefined();
    for (const path of ["/flowers","/guide","/faq","/account","/contact","/shipping-returns","/privacy","/terms","/commercial-transactions","/operations"]) expect(footer).toContain(`href="${path}"`);
    if (runtime === "production") {
      expect(footer).not.toContain('/preview/'); expect(footer).not.toContain('/referrals');
      expect(html).not.toContain('プレビュー版・注文と決済は発生しません');
    } else {
      expect(footer).toContain('href="/preview/gift-experience"');
      expect(html).toContain('プレビュー版・注文と決済は発生しません');
      expect(footer?.includes('href="/referrals"')).toBe(checkout === 'preview');
    }
  });
});
