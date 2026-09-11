# ADR 0006: Google operator login

Status: Implementation selection; live activation requires OAuth configuration and verified account binding.
Date: 2026-09-12. Supersedes: the unselected identity-provider assumption in ADR 0005.

## Context and decision

The user selected a Google account for operator login. Use the Google OIDC provider in pinned NextAuth 5.0.0-beta.32 (supports installed Next.js 16/React 19), with PKCE, state and nonce checks. Keep protocol verification in libraries, not custom cryptography. Auth.js relies on the TLS token endpoint for application-level signature authenticity; add explicit RS256 signature verification with pinned jose 6.2.11 and the fixed Google JWKS URL. See [jose remote-key verification](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md). This prerelease dependency requires real-provider verification before production use. Auth.js recommends the v5 beta for its current Next.js integration: https://authjs.dev/getting-started/installation.

Authentication infrastructure owns the provider/session boundary; Fulfillment continues to own shop permissions, review and approval. No customer identities or commerce tables are repurposed. Login requires a verified Google email on a server-configured allowlist. Resource access additionally requires an explicit server mapping of Google's stable subject to an opaque internal operator UUID, then the existing database shop permission. Login never creates identities or permission grants automatically. Personal email addresses and credentials remain outside public source control.

Use an encrypted, HttpOnly, host-only session cookie with SameSite=Lax and Secure on HTTPS. Sessions have an absolute 15-minute expiry without sliding extension; no Google access/refresh tokens, names or profile images are retained. Current allowlist and subject bindings are checked on each request. Removing an allowlist entry or binding revokes the respective access on subsequent requests; rotating the auth secret revokes all sessions. Individual session revocation and Google account-change notifications are future work.

Require a validated canonical AUTH_URL and fixed callback path; ignore caller-supplied return destinations by redirecting to /operations. Provider requests have PKCE/state/nonce verification; mutations use Auth.js CSRF checks or Next.js server-action origin checks. Protected pages and auth responses are private/no-store and no-referrer. Missing or invalid configuration fails closed. Runtime logging reports fixed event codes, never raw provider errors or token/profile payloads.

## Alternatives and consequences

A complete identity database and account-management UI are unnecessary for the initial small operator set. Explicit environment mappings are recoverable and require no schema migration; they are operational configuration, not customer authorization. Auth.js v4 does not target the installed Next.js/React combination; a handwritten OIDC/session stack would expand the critical code surface. The selected library remains replaceable behind FulfillmentOperatorIdentity.

## Rollout, rollback and verification

Default AUTH_OPERATOR_ENABLED is false. Configure Google Cloud OAuth credentials, canonical origin, secret and allowed emails; verify login privately, bind the verified subject to an operator UUID, and separately provision an audited shop permission. A dedicated DATABASE_OPERATOR_URL is required to read real orders. Never reuse the application/worker credential. No approval button or physical dispatch is activated.

Rollback disables operator login and removes the subject binding or rotates the session secret. Retain existing fulfillment records. Tests must cover config validation, verified-profile admission, immutable session identity on client updates, expiry/revocation, redirects, missing config, protected review denial and library cookie/session behavior. Real Google consent/callback success and deployment-origin behavior require credentials and remain explicit release prerequisites.

Deployment and revocation steps: [Google operator login](../../operations/GOOGLE_OPERATOR_LOGIN.md). No schema migration or automatic permission grant is introduced.
