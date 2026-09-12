# ADR 0009: Native commerce and direct Google customer authentication

- Status: Accepted direction, 2026-09-13; live commerce activation remains blocked.
- Decision: The user chose a custom commerce core after reviewing Shopify subscription costs.
- Supersedes: ADR 0001's Shopify authority, ADR 0003's Shopify Checkout selection and ADR 0008's Shopify customer authentication. ADR 0002's separation, persistence and recovery rules remain in force.

## Decision

BloomBox owns customer IDs, catalog, pricing, inventory, purchase intents, accepted orders and fulfillment in PostgreSQL. Google provides customer identity via OIDC directly to BloomBox, with a customer-only OAuth client/project, secret and cookies. Shopify is not involved in customer sign-in or native order-history reads. Authenticated Google issuer/subject identifies a customer; email is never an ownership key or an automatic account-merging mechanism. Operator identity and grants remain separate.

Reuse the existing Stripe Checkout adapter for the next payment integration step. Stripe is the proposed payment processor, not a new live merchant authorization. Card entry remains hosted by the payment service; BloomBox never handles card numbers. Payment facts come from verified provider events and reconciliation, not browser redirects. Provider assignment is immutable once checkout starts.

This decision removes the intended Shopify subscription dependency. It does not make hosting, databases, domains, payment processing or operational maintenance free.

## Initial implementation

Replace the unpublished Shopify customer-account route with direct Google OIDC and PostgreSQL customer identities. Reuse the existing customer tables without schema changes. Concurrent first logins serialize on the verified subject and create exactly one customer atomically. Disabled/anonymized accounts never reactivate on login. Account version changes invalidate existing sessions. Profile name/email are verified-login snapshots held only in the encrypted short-lived cookie; no contact is enrolled, merged or persisted implicitly.

Read order summaries through Order's public query contract and a buyer-to-customer join. Browser parameters control pagination only. Never use recipient identity, email matches, preview receipts or Shopify account IDs as ownership. Existing unlinked orders stay unlinked. Preserve distinct order, payment and fulfillment statuses; mixed states remain unknown rather than invented as paid or shipped.

## Security and recovery

PKCE/S256, state, nonce, RS256 signature, issuer, audience, verified email and expiry checks remain mandatory. Scope is openid/email/profile only. Google access/refresh/ID tokens are not retained. Cookies are HttpOnly and host-only, Secure on HTTPS; HTTP is allowed only on localhost/127.0.0.1 outside production runtime. Sessions have an absolute 15-minute maximum, with database identity/status/version rechecked. Fixed callbacks and post-login destination, bounded provider requests, redacted errors, no-store responses and CSRF remain in place.

## Migration and activation work

1. Configure a separate customer Google project/client, a fixed BloomBox callback and a private database. Record two-customer real-provider isolation and logout evidence.
2. Replace the production Shopify catalog adapter with a persistent native catalog and atomic inventory reservations. Keep JSON and memory preview-only.
3. Bind authenticated buyers at purchase creation, retain immutable purchase prices/destinations, and pass only opaque references into hosted checkout. Never retroactively claim orders by email.
4. Complete Stripe test checkout, signed inbox processing, amount/tax/shipping validation, timeout recovery, duplicate/out-of-order events, cancellations, refunds and reconciliation.
5. Connect native fulfillment operations and test stock release, partial fulfillment and refund behavior; replace Shopify-specific operator workflows as each native equivalent is verified.
6. Review tax/shipping, merchant identity, privacy/support, data retention, backups, restore and incident ownership before production activation. Update the release gate to require native catalog evidence when that adapter exists; do not remove the current failing gate merely to deploy.

The checked-in production composition still contains Shopify catalog/fulfillment adapters during migration. They are not the chosen end state and are not proof of a completed migration. No Shopify data, merchant accounts, OAuth credentials or accepted orders are deleted by this change.

## Alternatives and trade-offs

Shopify would reduce operational engineering at a recurring platform cost; the user explicitly chose native ownership. Direct Google plus Shopify email lookup is rejected because email does not establish order ownership. Building card processing or microservices is rejected as unnecessary risk. Existing domain boundaries and PostgreSQL transactions remain the smallest maintainable implementation.

## Rollback

Disable CUSTOMER_ACCOUNT_ENABLED to stop customer login/reads, then revert the application change if required. Keep created customer identities and commerce facts; never delete or rebind them as rollback. A return to Shopify authentication requires restoring its separate config and must not interpret native cookies. In-flight payments always retain their original provider. Production remains blocked until the new evidence is complete.

## Sources

- https://developers.google.com/identity/openid-connect/openid-connect
- https://stripe.com/jp/pricing
