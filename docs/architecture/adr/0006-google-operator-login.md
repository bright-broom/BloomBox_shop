# ADR 0006: Google operator login

Status: Implementation selection; live activation requires OAuth configuration and verified account binding.
Date: 2026-09-12. Supersedes: the unselected identity-provider assumption in ADR 0005.

## Context and decision

The user selected a Google account for operator login. Use the Google OIDC provider in pinned NextAuth 5.0.0-beta.32 (supports installed Next.js 16/React 19), with PKCE, state and nonce checks. Keep protocol verification in libraries, not custom cryptography. Auth.js relies on the TLS token endpoint for application-level signature authenticity; add explicit RS256 signature verification with pinned jose 6.2.11 and the fixed Google JWKS URL. See [jose remote-key verification](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md). This prerelease dependency requires real-provider verification before production use. Auth.js recommends the v5 beta for its current Next.js integration: https://authjs.dev/getting-started/installation.

Authentication infrastructure owns the provider/session boundary; Fulfillment continues to own shop permissions, review and approval. No customer identities or commerce tables are repurposed. Login requires a verified Google email on a server-configured allowlist. Resource access additionally requires an explicit server mapping of Google's stable subject to an opaque internal operator UUID, then the existing database shop permission. Login never creates identities or permission grants automatically. Personal email addresses and credentials remain outside public source control.

Use an encrypted, HttpOnly, host-only session cookie with SameSite=Lax and Secure on HTTPS. Sessions have an absolute 15-minute expiry without sliding extension; no Google access/refresh tokens, names or profile images are retained. Current allowlist and subject bindings are checked on each request. Removing an allowlist entry or binding revokes the respective access on subsequent requests; rotating the auth secret revokes all sessions.

Each configured subject binding may include a nonnegative integer `sessionVersion` (default 0). A verified login snapshots this version and its internal operator UUID inside the encrypted token; an unbound registration login snapshots version 0 and a null operator UUID. Every subsequent session resolution requires exact equality with current server configuration. Incrementing one binding's version rejects that subject's existing sessions across browsers without disrupting other operators; adding, removing or changing a binding also requires a new login. Client session updates cannot set or refresh these claims. Tokens predating these required claims fail closed and require login once after rollout. The browser session DTO remains subject and expiry only.

This extends the existing environment-owned small-operator configuration, with no session database or permission changes. Apply the new version to every serving process and never roll it back or reuse it (including after binding removal/reinstatement); keep a private configuration change record. Old instances can continue accepting old sessions until configuration is applied. This is account-wide session invalidation, not individual-device revocation, account suspension, or forced Google password/MFA reauthentication. It cannot cancel requests already authorized. Individual-session revocation and Google account-change notifications remain future work; a centralized session registry is warranted if immediate multi-instance/device control becomes a requirement.

Require a validated canonical AUTH_URL and fixed callback path; ignore caller-supplied return destinations by redirecting to /operations. Provider requests have PKCE/state/nonce verification; mutations use Auth.js CSRF checks or Next.js server-action origin checks. Protected pages and auth responses are private/no-store. Operator HTML uses Referrer-Policy: same-origin so native form POSTs retain their Origin; cross-origin Referer remains suppressed. Auth API responses retain no-referrer. Missing or invalid configuration fails closed. Runtime logging reports fixed event codes, never raw provider errors or token/profile payloads.

## Alternatives and consequences

A complete identity database and account-management UI are unnecessary for the initial small operator set. Explicit environment mappings are recoverable and require no schema migration; they are operational configuration, not customer authorization. Auth.js v4 does not target the installed Next.js/React combination; a handwritten OIDC/session stack would expand the critical code surface. The selected library remains replaceable behind FulfillmentOperatorIdentity.

## Rollout, rollback and verification

Default AUTH_OPERATOR_ENABLED is false. Configure Google Cloud OAuth credentials, canonical origin, secret and allowed emails; verify login privately, bind the verified subject to an operator UUID, and separately provision an audited shop permission. A dedicated DATABASE_OPERATOR_URL is required to read real orders. Never reuse the application/worker credential. No approval button or physical dispatch is activated.

Rollback disables operator login and removes the subject binding or rotates the session secret. Retain existing fulfillment records. Tests must cover config validation, verified-profile admission, immutable session identity on client updates, expiry/revocation, redirects, missing config, protected review denial and library cookie/session behavior. Real Google consent/callback success and deployment-origin behavior require credentials and remain explicit release prerequisites.

Deployment and revocation steps: [Google operator login](../../operations/GOOGLE_OPERATOR_LOGIN.md). No schema migration or automatic permission grant is introduced.

## Native form compatibility correction

Observed real-browser login after a full reload failed with `Invalid Server Actions request`: `no-referrer` caused a native POST to send `Origin: null`. Operator pages now use `same-origin`; this also supports submissions before hydration or with scripts unavailable. No null/foreign Origin allowlist, CSRF bypass, or client-only login dependency is introduced. Same-origin requests may include the operator page path, so existing no-PII/token URL rules remain necessary. API responses and checkout privacy headers remain unchanged. See [Origin header behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin#description).
