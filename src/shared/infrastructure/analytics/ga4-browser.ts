import {
  ANALYTICS_SECTION_ATTRIBUTE,
  ANALYTICS_SECTION_NAME,
  analyticsPageLocation,
  analyticsPagePath,
  analyticsReferrer,
  isAnalyticsExcludedPath,
  readAnalyticsConsent,
} from "@/shared/domain/analytics-policy";

type AnalyticsParams = Readonly<Record<string, unknown>>;
type QueuedEvent = Readonly<{ name: string; params: AnalyticsParams; userProperties?: AnalyticsParams }>;
type Gtag = (...args: unknown[]) => void;
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

const MAX_PENDING_EVENTS = 20;
const PURCHASE_STORAGE_KEY = "bloombox_analytics_purchases";
const state: { measurementId: string | null; loaded: boolean; pending: QueuedEvent[] } = { measurementId: null, loaded: false, pending: [] };

function analyticsWindow(): AnalyticsWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as AnalyticsWindow);
}

/** Google's documented per-property opt-out flag. */
function setDisabled(target: AnalyticsWindow, measurementId: string, disabled: boolean): void {
  Reflect.set(target, `ga-disable-${measurementId}`, disabled);
}

/** Every hit carries the query-free location of the current page, so no hit falls back to the full URL. */
function setLocation(target: AnalyticsWindow): string {
  const location = analyticsPageLocation(target.location.origin, target.location.pathname);
  target.gtag?.("set", { page_location: location });
  return location;
}

function send(target: AnalyticsWindow, event: QueuedEvent): void {
  setLocation(target);
  if (event.userProperties) target.gtag?.("set", "user_properties", event.userProperties);
  target.gtag?.("event", event.name, event.params);
}

/** Loads GA4 once, after consent, with advertising features and automatic page views off. */
export function startAnalytics(measurementId: string, scriptUrl: string): void {
  const target = analyticsWindow();
  if (!target) return;
  if (!state.loaded) {
    state.measurementId = measurementId;
    target.dataLayer = target.dataLayer ?? [];
    const queue = target.dataLayer;
    // gtag.js reads queued `arguments` objects, so the stub must push the arguments object itself.
    target.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      queue.push(arguments);
    };
    target.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    target.gtag("js", new Date());
    target.gtag("config", measurementId, {
      send_page_view: false,
      page_location: analyticsPageLocation(target.location.origin, target.location.pathname),
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_flags: target.location.protocol === "https:" ? "SameSite=Lax;Secure" : "SameSite=Lax",
    });
    const script = target.document.createElement("script");
    script.async = true;
    script.src = scriptUrl;
    target.document.head.appendChild(script);
    state.loaded = true;
  }
  setDisabled(target, measurementId, false);
  const queued = state.pending.splice(0);
  if (!isAnalyticsExcludedPath(target.location.pathname)) queued.forEach((event) => send(target, event));
}

/** Stops all collection, including automatic events, while an excluded screen is open. */
export function pauseAnalytics(paused: boolean): void {
  const target = analyticsWindow();
  if (target && state.measurementId) setDisabled(target, state.measurementId, paused);
}

export function stopAnalytics(): void {
  state.pending.length = 0;
  const target = analyticsWindow();
  if (!target || !state.measurementId) return;
  setDisabled(target, state.measurementId, true);
  target.gtag?.("consent", "update", { analytics_storage: "denied" });
  const host = target.location.hostname;
  for (const cookie of target.document.cookie.split(";")) {
    const name = cookie.split("=", 1)[0]?.trim() ?? "";
    if (!name.startsWith("_ga")) continue;
    for (const domain of ["", `; Domain=${host}`, `; Domain=.${host}`]) target.document.cookie = `${name}=; Max-Age=0; Path=/${domain}`;
  }
}

export function trackPageView(pathname: string): void {
  const target = analyticsWindow();
  if (!target || !state.loaded || isAnalyticsExcludedPath(pathname)) return;
  const location = analyticsPageLocation(target.location.origin, pathname);
  const referrer = analyticsReferrer(target.location.origin, target.document.referrer) ?? "";
  target.gtag?.("set", { page_location: location, page_referrer: referrer });
  target.gtag?.("event", "page_view", { page_location: location, page_referrer: referrer, page_title: target.document.title });
}

/** Sends now after consent, queues briefly while the choice is pending, and drops when declined or excluded. */
export function trackAnalyticsEvent(name: string, params: AnalyticsParams, userProperties?: AnalyticsParams): void {
  const target = analyticsWindow();
  if (!target || isAnalyticsExcludedPath(target.location.pathname)) return;
  const consent = readAnalyticsConsent(target.document.cookie);
  if (consent === "denied") return;
  if (consent === "unknown" || !state.loaded) {
    if (state.pending.length < MAX_PENDING_EVENTS) state.pending.push({ name, params, userProperties });
    return;
  }
  send(target, { name, params, userProperties });
}

/** A reload of the confirmation page in the same tab must not report the purchase twice. */
export function trackPurchaseOnce(transactionId: string, params: AnalyticsParams, userProperties: AnalyticsParams): void {
  const target = analyticsWindow();
  if (!target) return;
  let reported: string[] = [];
  try {
    const stored: unknown = JSON.parse(target.sessionStorage.getItem(PURCHASE_STORAGE_KEY) ?? "[]");
    reported = Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
  } catch {
    reported = [];
  }
  if (reported.includes(transactionId)) return;
  trackAnalyticsEvent("purchase", params, userProperties);
  try {
    target.sessionStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify([...reported, transactionId].slice(-10)));
  } catch {
    // Storage can be unavailable in private browsing; GA4 still deduplicates by transaction ID.
  }
}

/** Reports each marked section once per page view when it reaches the middle band of the viewport. */
export function observeSections(pathname: string): () => void {
  const target = analyticsWindow();
  if (!target || typeof IntersectionObserver === "undefined") return () => undefined;
  const seen = new Set<string>();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const name = entry.target.getAttribute(ANALYTICS_SECTION_ATTRIBUTE) ?? "";
      observer.unobserve(entry.target);
      if (!ANALYTICS_SECTION_NAME.test(name) || seen.has(name)) continue;
      seen.add(name);
      trackAnalyticsEvent("section_view", { section_name: name, page_path: analyticsPagePath(pathname) });
    }
  }, { rootMargin: "-40% 0px -40% 0px", threshold: 0 });
  target.document.querySelectorAll(`[${ANALYTICS_SECTION_ATTRIBUTE}]`).forEach((element) => observer.observe(element));
  return () => observer.disconnect();
}
