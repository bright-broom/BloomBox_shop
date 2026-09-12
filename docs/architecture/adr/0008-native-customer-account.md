# ADR 0008: Native BloomBox customer account

Status: Implementation selection, 2026-09-13. Live authentication remains disabled until the Shopify client and isolated-store evidence are configured.

## Decision

The user chose a BloomBox-native account screen instead of Shopify's hosted account UI. Shopify remains the commerce/customer system of record (ADR 0001). The first increment is read-only: passwordless Shopify OIDC login, a native paginated order-history screen, name/email display, and local BloomBox logout. Address/profile mutations, order details, return/refund commands and production referral binding remain separate work.

Customer owns its read model and query. Its infrastructure adapter uses only the authenticated customer's Customer Account API token and the `customer` query. No caller-selected customer ID, Admin API credential, email-based order lookup or browser checkout receipt is accepted as identity. The view never enrolls recipients or merges them with buyers.

Reuse the pinned NextAuth and jose libraries already used by operator login, with separate routes, cookies and secret. Use a Shopify Headless confidential client, PKCE/S256, state, nonce, explicit RS256 signature/issuer/audience verification, HTTPS callbacks and a fixed post-login destination. Discover endpoints from the configured myshopify domain and verify they match the explicitly configured shop ID and supported API version. Custom account domains require a reviewed extension of this exact allowlist.

The short-lived access token is stored only inside Auth.js's encrypted HttpOnly/Secure/host-only cookie, never session JSON, localStorage or client props. A narrow server-only `next-auth/jwt` adapter reads the encrypted credential to call Shopify; this pinned low-level API is explicitly marked unstable upstream and must have its cookie/expiry compatibility tests rerun on upgrades. No refresh token is retained. Absolute session lifetime is at most 15 minutes and capped by provider expiry; expired sessions reauthenticate. This favors a bounded initial implementation over a refresh-token race/revocation subsystem. Logout clears BloomBox's cookie; it does not claim global Shopify SSO revocation. AUTH_URL is mandatory and must match the configured application origin so server-action callback construction never trusts forwarded headers.

## Security and failure behavior

- Reject missing/invalid configuration, wrong origins, forged cookies, client session updates, wrong shop/client, callback replay parameters and invalid provider responses.
- Fixed shop-scoped endpoints, no redirect following, 5-second timeouts and 256-KiB response caps. No provider payloads or tokens in logs.
- Private/no-store account and authentication responses; noindex and restricted referrers. Native forms keep same-origin referrers so Origin validation works.
- API failures are not empty order lists. No retries that write anything; all account queries are read-only.
- Request only name/email and order summaries. No shipping addresses, gift messages, phone, payment instruments, order-status capability URLs or recipient details.
- The preview route contains explicitly synthetic data, cannot create a session, and returns 404 in production mode. Test checkout receipts and preview coupons are never represented as real account purchases or value.

## Rollout and rollback

See [customer account setup and verification](../../operations/CUSTOMER_ACCOUNT.md). Keep CUSTOMER_ACCOUNT_ENABLED absent/false until isolated-shop callback and two-customer isolation evidence exists. Enabling accounts does not activate commerce or satisfy the production release gate. Disable the flag to stop reads/login, or revert this change. No schema migration or customer data deletion is required.

## References

- [Shopify Customer Account setup](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started)
- [Authentication and discovery](https://shopify.dev/docs/api/customer/latest)
- [Customer query](https://shopify.dev/docs/api/customer/latest/queries/customer)
- [Order fields and totalPrice semantics](https://shopify.dev/docs/api/customer/latest/objects/Order)
