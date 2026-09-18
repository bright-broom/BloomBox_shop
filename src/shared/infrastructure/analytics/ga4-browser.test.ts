import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Runtime = typeof import("./ga4-browser");

function fakeBrowser(pathname: string, cookie = "") {
  const jar = new Map<string, string>();
  for (const part of cookie.split(";").filter(Boolean)) {
    const [name, value = ""] = part.trim().split("=", 2);
    jar.set(name ?? "", value);
  }
  const appended: Array<{ src?: string; async?: boolean }> = [];
  const storage = new Map<string, string>();
  const document = {
    title: "BloomBox",
    referrer: "https://search.example/q?name=private",
    head: { appendChild: (element: { src?: string; async?: boolean }) => appended.push(element) },
    createElement: () => ({}),
    querySelectorAll: () => [],
    get cookie() { return [...jar].map(([name, value]) => `${name}=${value}`).join("; "); },
    set cookie(value: string) {
      const [pair = "", ...attributes] = value.split(";");
      const [name = "", content = ""] = pair.split("=", 2);
      if (attributes.some((attribute) => attribute.trim() === "Max-Age=0")) jar.delete(name.trim());
      else jar.set(name.trim(), content);
    },
  };
  const window = {
    location: { pathname, origin: "https://shop.example", protocol: "https:", hostname: "shop.example" },
    document,
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
  } as unknown as Window & { dataLayer?: IArguments[] } & Record<string, unknown>;
  vi.stubGlobal("window", window);
  return { window, appended, jar };
}

function calls(window: { dataLayer?: IArguments[] }) {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry));
}

let runtime: Runtime;
beforeEach(async () => {
  vi.resetModules();
  runtime = await import("./ga4-browser");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analytics runtime", () => {
  it("loads the tag once with advertising features and automatic page views off", () => {
    const { window, appended } = fakeBrowser("/flowers", "bloombox_analytics_consent=granted");
    runtime.startAnalytics("G-TEST1234", "https://tag.example/gtag.js?id=G-TEST1234");
    runtime.startAnalytics("G-TEST1234", "https://tag.example/gtag.js?id=G-TEST1234");
    expect(appended).toEqual([{ async: true, src: "https://tag.example/gtag.js?id=G-TEST1234" }]);
    const sent = calls(window);
    expect(sent[0]).toEqual(["consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" }]);
    expect(sent[2]).toEqual(["config", "G-TEST1234", expect.objectContaining({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false })]);
    expect(window["ga-disable-G-TEST1234"]).toBe(false);
  });

  it("sends page views without query strings or external referrer paths", () => {
    const { window } = fakeBrowser("/checkout/success", "bloombox_analytics_consent=granted");
    runtime.startAnalytics("G-TEST1234", "https://tag.example/gtag.js");
    runtime.trackPageView("/checkout/success?session_id=cs_live_secret");
    const serialized = JSON.stringify(calls(window));
    expect(serialized).not.toContain("cs_live_secret");
    expect(serialized).not.toContain("private");
    expect(calls(window).at(-1)).toEqual(["event", "page_view", { page_location: "https://shop.example/checkout/success", page_referrer: "https://search.example", page_title: "BloomBox" }]);
  });

  it("never sends from excluded screens", () => {
    const { window } = fakeBrowser("/gift/mint-m", "bloombox_analytics_consent=granted");
    runtime.startAnalytics("G-TEST1234", "https://tag.example/gtag.js");
    const before = calls(window).length;
    runtime.trackPageView("/gift/mint-m");
    runtime.trackAnalyticsEvent("view_item", { item_id: "mint-m" });
    expect(calls(window)).toHaveLength(before);
    runtime.pauseAnalytics(true);
    expect(window["ga-disable-G-TEST1234"]).toBe(true);
  });

  it("queues events until consent, then sends them; a refusal drops them", () => {
    const { window, jar } = fakeBrowser("/cart");
    runtime.trackAnalyticsEvent("view_cart", { currency: "JPY" });
    expect(window.dataLayer).toBeUndefined();
    jar.set("bloombox_analytics_consent", "granted");
    runtime.startAnalytics("G-TEST1234", "https://tag.example/gtag.js");
    expect(calls(window).slice(-2)).toEqual([["set", { page_location: "https://shop.example/cart" }], ["event", "view_cart", { currency: "JPY" }]]);

    jar.set("bloombox_analytics_consent", "denied");
    const before = calls(window).length;
    runtime.trackAnalyticsEvent("begin_checkout", { currency: "JPY" });
    expect(calls(window)).toHaveLength(before);
  });

  it("keeps at most twenty pending events while the choice is open", () => {
    const { window, jar } = fakeBrowser("/");
    for (let index = 0; index < 25; index += 1) runtime.trackAnalyticsEvent("section_view", { index });
    jar.set("bloombox_analytics_consent", "granted");
    runtime.startAnalytics("G-TEST1234", "https://tag.example/gtag.js");
    expect(calls(window).filter(([command]) => command === "event")).toHaveLength(20);
  });

  it("reports a purchase once per transaction in the tab, with the user property first", () => {
    const { window } = fakeBrowser("/checkout/success", "bloombox_analytics_consent=granted");
    runtime.startAnalytics("G-TEST1234", "https://tag.example/gtag.js");
    runtime.trackPurchaseOnce("BB-1", { transaction_id: "BB-1" }, { customer_type: "first_purchase" });
    runtime.trackPurchaseOnce("BB-1", { transaction_id: "BB-1" }, { customer_type: "first_purchase" });
    const purchases = calls(window).filter(([, name]) => name === "purchase");
    expect(purchases).toHaveLength(1);
    expect(calls(window).slice(-3)).toEqual([
      ["set", { page_location: "https://shop.example/checkout/success" }],
      ["set", "user_properties", { customer_type: "first_purchase" }],
      ["event", "purchase", { transaction_id: "BB-1" }],
    ]);
  });

  it("stops collection and removes Google Analytics cookies on refusal", () => {
    const { window, jar } = fakeBrowser("/", "bloombox_analytics_consent=granted; _ga=GA1.1.1; _ga_TEST=GS1; other=1");
    runtime.startAnalytics("G-TEST1234", "https://tag.example/gtag.js");
    runtime.stopAnalytics();
    expect(window["ga-disable-G-TEST1234"]).toBe(true);
    expect(calls(window).at(-1)).toEqual(["consent", "update", { analytics_storage: "denied" }]);
    expect([...jar.keys()].sort()).toEqual(["bloombox_analytics_consent", "other"]);
  });
});
