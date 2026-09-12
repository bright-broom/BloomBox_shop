# Native customer account

2026-09-13. `/account` is a native BloomBox screen for the authenticated customer's order summaries and name/email. It uses Shopify Customer Account API 2026-07, not the Admin API, operator authentication or test checkout storage. See [ADR 0008](../architecture/adr/0008-native-customer-account.md).

## Implemented

- Shopify OIDC sign-in and local BloomBox logout with separate cookies and secret.
- Read-only order history, newest first, 10 per page; payment/fulfillment status remain distinct. Cancellation has its own label.
- Current total in JPY, reflecting Shopify's current `totalPrice` (not an immutable purchase-time receipt).
- Native name/email display, empty history, expired login, unavailable provider and unavailable configuration states.
- Desktop/mobile/footer entry links; private/no-store, noindex, restricted referrers.
- `/preview/account` offers orders/empty/signed-out/expired/unavailable sample states. Preview-only; never grants authentication.

## Required external setup (not yet verified)

Use the development store's Headless storefront → Customer Account API settings. Enable new customer accounts, choose a confidential client, and register an exact stable HTTPS callback:

`https://<review-origin>/api/customer-auth/callback/shopify-customer`

Shopify does not allow HTTP/localhost callbacks. A stable review hostname avoids registering a new origin for every immutable Preview URL. Do not enable this globally for unrelated Vercel preview branches.

Set privately in the appropriate server environment (never public JSON, browser storage or chat):

| Setting | Value |
| --- | --- |
| CUSTOMER_ACCOUNT_ENABLED | `true` only after setup and isolated testing; absent/false by default |
| AUTH_URL | Same exact HTTPS application origin; mandatory so Auth.js server actions never derive callbacks from forwarded headers |
| CUSTOMER_ACCOUNT_ORIGIN | Exact HTTPS BloomBox origin, without path/query/credentials |
| CUSTOMER_ACCOUNT_SECRET | Independent random secret, at least 32 characters; rotate to invalidate all BloomBox customer cookies |
| CUSTOMER_ACCOUNT_CLIENT_ID | Customer Account API client ID; not the Storefront API token |
| CUSTOMER_ACCOUNT_CLIENT_SECRET | Confidential Customer Account client secret |
| CUSTOMER_ACCOUNT_SHOP_ID | Numeric shop ID verified against storefront discovery |
| SHOPIFY_STORE_DOMAIN | Same store's canonical myshopify.com domain |

AUTH_URL is required and must identify the same application origin, including when operator authentication is already configured. AUTH_REDIRECT_PROXY_URL and NEXTAUTH_URL overrides are rejected. The currently supported discovery layout is shopify.com scoped to that shop ID; custom account domains require an adapter update and tests.

The existing development store's public discovery endpoint was read successfully on 2026-09-13, including Customer Account API version 2026-07. This does not verify a configured Customer Account client, callback, authenticated customer or order data. No merchant/user registration or live settings were changed.

## Verification and threat checks

Automated checks cover the complete synthetic signed OAuth callback through the actual Auth.js handlers; CSRF, nonce, issuer, audience, signature and expiry rejection; encrypted cookie tampering and shop/client separation; local logout; token-free session JSON; bounded requests and responses; tenant-scoped API requests; pagination; unknown states; money; empty-versus-error behavior; sample-route isolation and escaped profile data.

Auth.js currently derives discovery from issuer and requires a userinfo endpoint in one discovery branch. The adapter maps only the exact expected issuer discovery request to the canonical storefront discovery, verifies its issuer/endpoints, and specifies the matching token endpoint. Shopify has no userinfo endpoint: verified ID-token claims supply identity. Tests use that actual no-userinfo discovery shape.

Before enabling outside controlled tests, verify with two isolated Shopify customers: correct login/callback, the corresponding order lists only, pagination, cancellation/refund labels, empty account, API refusal, session expiry, local logout and browser back/reload. Inspect deployed private/no-store headers and ensure network/client props/session JSON do not expose tokens. Do not send login emails or modify real customers merely to populate a demo.

## Recorded verification — 2026-09-13

- `pnpm check:ci`: 859 passed, 138 skipped; repository/architecture/content/design/migration checks, typecheck, lint and production build passed.
- 54 focused account tests, including complete synthetic OAuth callbacks and code-verifier challenge validation. Existing PostgreSQL tests are skipped locally and remain part of CI's isolated database job.
- Chrome: desktop order/profile view; 390px order view; 320px empty and provider-failure states. Document width matched viewport at both mobile widths. Footer account navigation was exercised. These are synthetic design states, not authenticated customer/Shopify E2E evidence.
- Local `/account` returns 200 with private/no-store, same-origin referrer and noindex headers; disabled `/api/customer-auth/session` returns 503 with private/no-store and no-referrer.
- `pnpm check:production` still rejects unapproved customer-facing content and production commerce activation. No production approval was changed.

## Remaining account work

1. Configure the isolated Shopify client and stable HTTPS review origin, then record real-provider callback and two-customer authorization evidence.
2. Order details, line items, tracking and refund breakdown with customer-scoped access and correct money semantics.
3. Address-book and profile editing: input validation, CSRF, double-submit/error handling and a clear distinction between saved addresses and historical order destinations.
4. Bind production referral rewards to verified customer identity and Shopify discount eligibility. Preview persona/coupon data must not become real customer value.
5. Longer-lived sessions only with a designed refresh-token rotation/revocation mechanism; global Shopify logout/account switching needs its own evidence.
6. Privacy/support processes for profile correction, account deletion and retention. Local logout alone does not terminate Shopify SSO.

## Rollback

Disable CUSTOMER_ACCOUNT_ENABLED or revert the feature commit. No database migrations, customer writes, or payments are performed by this feature. Keep the commerce activation gate blocked independently.
