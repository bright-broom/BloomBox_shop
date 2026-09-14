export type LoginArea = "customer" | "operator";
export const ACCOUNT_HOME = "/account";
export const OPERATOR_HOME = "/operations";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
/** Narrow local destinations only: never carry arbitrary URLs or query data through login. */
export function loginDestination(value: unknown, area: LoginArea): string {
  const home = area === "customer" ? ACCOUNT_HOME : OPERATOR_HOME;
  if (typeof value !== "string") return home;
  if (area === "customer") return value === home || new RegExp(`^/account/orders/${uuid}$`, "i").test(value) ? value : home;
  return [home, "/operations/catalog", "/operations/customers", "/operations/permissions", "/operations/fulfillments"].includes(value)
    || new RegExp(`^/operations/customers/${uuid}$`, "i").test(value)
    || new RegExp(`^/operations/fulfillments/[a-z0-9][a-z0-9-]*\\.myshopify\\.com/${uuid}$`, "i").test(value) ? value : home;
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
