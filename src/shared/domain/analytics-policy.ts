/**
 * Web analytics scope (ADR 0018). Pure rules shared by the proxy, server components and the browser loader.
 * Excluded screens handle gift messages, recipients, sign-in, customer accounts, staff work, tests or previews:
 * no analytics script loads there and no event is sent from them.
 */
export const ANALYTICS_EXCLUDED_PATH_PREFIXES = [
  "/gift", "/gift-next", "/account", "/operations", "/order", "/checkout/test", "/preview", "/referrals", "/api",
] as const;

export const ANALYTICS_CONSENT_COOKIE = "bloombox_analytics_consent";
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
/** Dispatched on window after the visitor changes the analytics choice, so the loader reacts without a reload. */
export const ANALYTICS_CONSENT_EVENT = "bloombox:analytics-consent";
export const ANALYTICS_SECTION_ATTRIBUTE = "data-analytics-section";
export const ANALYTICS_SECTION_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export type AnalyticsConsent = "granted" | "denied" | "unknown";
export type AnalyticsCustomerType = "first_purchase" | "repeat_purchase" | "guest";

/** The path only: query strings and fragments can carry checkout capabilities or personal data. */
export function analyticsPagePath(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  return path.startsWith("/") ? path : "/";
}

export function isAnalyticsExcludedPath(pathname: string): boolean {
  const path = analyticsPagePath(pathname);
  return ANALYTICS_EXCLUDED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function analyticsPageLocation(origin: string, pathname: string): string {
  return `${new URL(origin).origin}${analyticsPagePath(pathname)}`;
}

/** Same-site referrers keep only their path; other sites keep only their origin. */
export function analyticsReferrer(origin: string, referrer: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const source = new URL(referrer);
    if (!["http:", "https:"].includes(source.protocol)) return undefined;
    return source.origin === new URL(origin).origin ? `${source.origin}${analyticsPagePath(source.pathname)}` : source.origin;
  } catch {
    return undefined;
  }
}

export function readAnalyticsConsent(cookieHeader: string): AnalyticsConsent {
  for (const part of cookieHeader.split(";")) {
    const [name, value] = part.trim().split("=", 2);
    if (name === ANALYTICS_CONSENT_COOKIE) return value === "granted" || value === "denied" ? value : "unknown";
  }
  return "unknown";
}

export function analyticsConsentCookie(choice: "granted" | "denied", secure: boolean): string {
  return `${ANALYTICS_CONSENT_COOKIE}=${choice}; Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Maps the order module's first/repeat/guest classification to the GA4 custom dimension value. */
export const ANALYTICS_CUSTOMER_TYPES = {
  FIRST: "first_purchase",
  REPEAT: "repeat_purchase",
  GUEST: "guest",
} as const satisfies Record<string, AnalyticsCustomerType>;

export type PurchaseAnalyticsInput = Readonly<{
  transactionId: string;
  totalYen: number;
  productId: string;
  productName: string;
  quantity: number;
  customerType: AnalyticsCustomerType;
}>;

/** A GA4 purchase event with IDs and amounts only. No buyer, recipient, address or message is included. */
export function purchaseAnalytics(input: PurchaseAnalyticsInput) {
  return {
    params: {
      transaction_id: input.transactionId,
      value: input.totalYen,
      currency: "JPY",
      customer_type: input.customerType,
      items: [{ item_id: input.productId, item_name: input.productName, quantity: input.quantity }],
    },
    userProperties: { customer_type: input.customerType },
  } as const;
}
