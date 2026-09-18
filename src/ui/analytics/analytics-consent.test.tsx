import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const harness = vi.hoisted(() => ({ pathname: "/", consent: "unknown" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => harness.pathname }));
vi.mock("./use-analytics-consent", () => ({ useAnalyticsConsent: () => harness.consent }));

import { AnalyticsConsentPanel } from "./analytics-consent";

beforeEach(() => {
  harness.pathname = "/";
  harness.consent = "unknown";
});

describe("AnalyticsConsentPanel", () => {
  it("asks an undecided visitor on measured pages, with refusal offered first", () => {
    const html = renderToStaticMarkup(<AnalyticsConsentPanel />);
    expect(html).toContain("アクセス解析へのご協力のお願い");
    expect(html.indexOf("同意しない")).toBeLessThan(html.indexOf("同意する<"));
    expect(html).toContain("href=\"/privacy\"");
  });

  it.each(["/gift/mint-m", "/account/login", "/gift-next"])("does not interrupt the excluded screen %s", (path) => {
    harness.pathname = path;
    const html = renderToStaticMarkup(<AnalyticsConsentPanel />);
    expect(html).not.toContain("アクセス解析へのご協力のお願い");
    expect(html).toContain("アクセス解析の設定");
  });

  it("does not ask again after a choice, or before the browser choice is known", () => {
    for (const consent of ["granted", "denied", null]) {
      harness.consent = consent;
      expect(renderToStaticMarkup(<AnalyticsConsentPanel />)).not.toContain("アクセス解析へのご協力のお願い");
    }
  });

  it("renders nothing on staff screens", () => {
    harness.pathname = "/operations/orders";
    expect(renderToStaticMarkup(<AnalyticsConsentPanel />)).toBe("");
  });
});
