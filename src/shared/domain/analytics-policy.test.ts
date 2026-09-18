import { describe, expect, it } from "vitest";
import {
  ANALYTICS_CONSENT_MAX_AGE_SECONDS,
  analyticsConsentCookie,
  analyticsPageLocation,
  analyticsPagePath,
  analyticsReferrer,
  isAnalyticsExcludedPath,
  purchaseAnalytics,
  readAnalyticsConsent,
} from "./analytics-policy";

describe("analytics scope", () => {
  it.each([
    "/gift/prod-m", "/gift", "/gift-next", "/gift-next/letter", "/account", "/account/login", "/account/orders/1",
    "/operations", "/operations/login", "/order/abc", "/checkout/test/payment", "/preview/account", "/referrals", "/api/advertising/consent",
    "/gift/prod-m?message=hello",
  ])("excludes %s", (path) => {
    expect(isAnalyticsExcludedPath(path)).toBe(true);
  });

  it.each(["/", "/flowers", "/flowers/mint-m", "/cart", "/checkout/success", "/about", "/guide", "/faq", "/gifting", "/accounting", "/orders"])(
    "measures %s",
    (path) => {
      expect(isAnalyticsExcludedPath(path)).toBe(false);
    },
  );

  it("drops query strings and fragments that can carry checkout capabilities", () => {
    expect(analyticsPagePath("/checkout/success?session_id=cs_live_secret#top")).toBe("/checkout/success");
    expect(analyticsPageLocation("https://shop.example/any?x=1", "/cart?added=1")).toBe("https://shop.example/cart");
    expect(analyticsPagePath("relative")).toBe("/");
  });

  it("keeps a same-site referrer path and only the origin of other sites", () => {
    expect(analyticsReferrer("https://shop.example", "https://shop.example/flowers/mint-m?utm=x")).toBe("https://shop.example/flowers/mint-m");
    expect(analyticsReferrer("https://shop.example", "https://search.example/q?name=private")).toBe("https://search.example");
    expect(analyticsReferrer("https://shop.example", "")).toBeUndefined();
    expect(analyticsReferrer("https://shop.example", "not a url")).toBeUndefined();
    expect(analyticsReferrer("https://shop.example", "javascript:alert(1)")).toBeUndefined();
  });
});

describe("analytics consent cookie", () => {
  it("reads only the analytics cookie and treats other values as unknown", () => {
    expect(readAnalyticsConsent("a=1; bloombox_analytics_consent=granted; b=2")).toBe("granted");
    expect(readAnalyticsConsent("bloombox_analytics_consent=denied")).toBe("denied");
    expect(readAnalyticsConsent("bloombox_analytics_consent=yes")).toBe("unknown");
    expect(readAnalyticsConsent("other=granted")).toBe("unknown");
    expect(readAnalyticsConsent("")).toBe("unknown");
  });

  it("writes a first-party, lax cookie for 180 days and marks it secure on HTTPS", () => {
    expect(analyticsConsentCookie("granted", true)).toBe(`bloombox_analytics_consent=granted; Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`);
    expect(analyticsConsentCookie("denied", false)).not.toContain("Secure");
    expect(ANALYTICS_CONSENT_MAX_AGE_SECONDS).toBe(15_552_000);
  });
});

describe("purchaseAnalytics", () => {
  it("builds a JPY purchase event with the customer type and no personal data", () => {
    const event = purchaseAnalytics({ transactionId: "BB-1", totalYen: 5000, productId: "mint-m", productName: "BLOOM BOX M", quantity: 1, customerType: "repeat_purchase" });
    expect(event).toEqual({
      params: { transaction_id: "BB-1", value: 5000, currency: "JPY", customer_type: "repeat_purchase",
        items: [{ item_id: "mint-m", item_name: "BLOOM BOX M", quantity: 1 }] },
      userProperties: { customer_type: "repeat_purchase" },
    });
  });
});
