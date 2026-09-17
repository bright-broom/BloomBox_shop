/** Only Proxy supplies the nonce; never reuse a value supplied by the browser. */
export function browserPolicy(nonce: string, pathname: string, development: boolean): string {
  if (!/^[A-Za-z0-9+/]{32}$/.test(nonce)) throw new Error("Invalid CSP nonce");
  const googleForm = /^\/(account|operations)(\/|$)|^\/api\/(customer-auth|operator-auth)(\/|$)/.test(pathname);
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // Existing React style attributes are used for layout; this does not permit inline JavaScript.
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    `form-action 'self'${googleForm ? " https://accounts.google.com" : ""}`,
    "frame-ancestors 'none'",
  ].join("; ");
}
