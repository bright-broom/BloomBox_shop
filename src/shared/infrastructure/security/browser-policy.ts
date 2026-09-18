/** Hosts the consented GA4 tag sends to (ADR 0018). The tag loader itself runs through the nonce and 'strict-dynamic'. */
const ANALYTICS_CONNECT = " https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com";
const ANALYTICS_IMAGE = " https://*.google-analytics.com https://*.googletagmanager.com";

/** Only Proxy supplies the nonce; never reuse a value supplied by the browser. */
export function browserPolicy(nonce: string, pathname: string, development: boolean, analytics = false): string {
  if (!/^[A-Za-z0-9+/]{32}$/.test(nonce)) throw new Error("Invalid CSP nonce");
  const googleForm = /^\/(account|operations)(\/|$)|^\/api\/(customer-auth|operator-auth)(\/|$)/.test(pathname);
  // Staff screens never load analytics, so they keep the narrowest policy.
  const measured = analytics && !/^\/operations(\/|$)/.test(pathname);
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // Existing React style attributes are used for layout; this does not permit inline JavaScript.
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self'${measured ? ANALYTICS_CONNECT : ""}`,
    `img-src 'self' data: blob:${measured ? ANALYTICS_IMAGE : ""}`,
    "font-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    `form-action 'self'${googleForm ? " https://accounts.google.com" : ""}`,
    "frame-ancestors 'none'",
  ].join("; ");
}
