export type LoginArea = "customer" | "operator";
export const ACCOUNT_HOME = "/account";
export const OPERATOR_HOME = "/operations";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
/**
 * The only query allowed through login: the product a signed-out visitor asked to add to their favorites.
 * It is a catalog identifier, never free text, so nothing else can ride along.
 */
const FAVORITE_ADD = new RegExp(`^/account/favorites\\?add=(?:[a-z0-9][a-z0-9_-]{0,63}|native_${uuid})$`);
/** Narrow local destinations only: never carry arbitrary URLs or query data through login. */
export function loginDestination(value: unknown, area: LoginArea): string {
  const home = area === "customer" ? ACCOUNT_HOME : OPERATOR_HOME;
  if (typeof value !== "string") return home;
  if (area === "customer") {
    return [home, "/account/welcome", "/account/profile", "/account/addresses", "/account/favorites", "/account/settings", "/account/support"].includes(value)
      || new RegExp(`^/account/orders/${uuid}$`, "i").test(value) || FAVORITE_ADD.test(value) ? value : home;
  }
  return [home, "/operations/requests", "/operations/orders", "/operations/reports", "/operations/settings", "/operations/catalog", "/operations/catalog/history", "/operations/customers", "/operations/permissions", "/operations/fulfillments", "/operations/native-fulfillments"].includes(value)
    || new RegExp(`^/operations/native-fulfillments/${uuid}$`, "i").test(value)
    || new RegExp(`^/operations/customers/${uuid}$`, "i").test(value)
    || new RegExp(`^/operations/fulfillments/[a-z0-9][a-z0-9-]*\\.myshopify\\.com/${uuid}$`, "i").test(value) ? value : home;
}
/** The registration completion page, returning to an allowed account page afterwards. */
export function membershipWelcomeHref(destination?: unknown): string {
  const next = loginDestination(destination, "customer");
  return `${ACCOUNT_HOME}/welcome${next === ACCOUNT_HOME || next === `${ACCOUNT_HOME}/welcome` ? "" : `?next=${encodeURIComponent(next)}`}`;
}
export function loginHref(area: LoginArea, destination?: unknown): string {
  const home = area === "customer" ? ACCOUNT_HOME : OPERATOR_HOME;
  const next = loginDestination(destination, area);
  return `${home}/login${next === home ? "" : `?next=${encodeURIComponent(next)}`}`;
}
export function authRedirect(url: string, origin: string, area: LoginArea): string {
  const home = area === "customer" ? ACCOUNT_HOME : OPERATOR_HOME;
  try {
    const target = new URL(url, origin);
    if (target.origin !== origin || target.username || target.password) return origin + home;
    if (target.pathname === home + "/login" && !target.search && !target.hash) return origin + target.pathname;
    return origin + loginDestination(target.pathname + target.search + target.hash, area);
  } catch { return origin + home; }
}
