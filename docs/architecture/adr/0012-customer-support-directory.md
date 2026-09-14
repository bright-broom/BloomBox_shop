# ADR 0012: Customer support directory

- Status: Implemented for isolated verification; production access remains unconfigured.
- Date: 2026-09-14
- Context: The user requested customer management. ADR 0009 already assigns customers and buyer bindings to BloomBox. Customer self-service history and catalog administration do not provide support access to customers.

## Decision

Add a read-only support directory inside the existing operations application. Customer owns account lookup; Order exposes buyer-linked native order summaries through its public contract. Shared operator security composes both under a dedicated support grant and transaction. Reuse operator Google authentication; do not reuse customer sessions, catalog authority or fulfillment authority.

Use a dedicated `bloombox_customer_support` database role and `DATABASE_CUSTOMER_SUPPORT_URL`. Grants are explicit, expiring and disabled by default. The role reads only necessary account/order/status columns. It cannot access Google identities, contact payloads, gift messages, addresses, payment provider identifiers, or write commerce records.

The first increment supports exact customer ID or order-number lookup, account-state filtering, bounded pagination and order/payment/fulfillment summaries. Customer IDs come from immutable buyer bindings. Recipient identity, email matches, unlinked purchases and legacy Shopify orders never claim customer ownership. Anonymized accounts have no support history view. Contact registration, name/email search, notes, messaging, exports and account/commerce mutations remain separate work.

## Failure and privacy

Authorize before querying and recheck grant/session expiry before returning. Hold a shared grant lock to serialize revocation against reads. Insert an access record containing operator ID, action, returned opaque customer IDs and time in the same transaction. If audit persistence fails, do not disclose results. This audited operation is named `open`, not a side-effect-free query.

Pages are dynamic, private/no-store and noindex. Disable prefetch on support links so speculative navigation does not read customer records or create misleading audit entries. Validate search and cursor input; never log raw input or exceptions. Independent payment and fulfillment states remain independent; mixed states are labeled for review rather than presented as paid/delivered. Current Google profile handling is unchanged: name/email snapshots remain in the encrypted short-lived customer cookie, without implicit contact enrollment.

## Alternatives

An external CRM would add a provider, data transfer, ownership and synchronization decisions before the basic support need is validated. Reusing catalog grants would broaden unrelated privileges. Broad database read access would unnecessarily reveal recipient and authentication data. This increment extends existing native modules instead.

## Rollout and rollback

Apply migration 0024 and the roles file with migration authority, configure a dedicated database login, and grant access only to an approved operator. Local synthetic-session and isolated-DB evidence is separate from real Google and production verification. Audit retention/access procedures and operator assignments need approval before production use. See [CUSTOMER_MANAGEMENT.md](../../operations/CUSTOMER_MANAGEMENT.md).

To disable support access, revoke the support grant and wait for active transactions, then remove the support connection. Revert the application change if required. Preserve audit records and migration history; do not modify customer, order or payment facts as rollback.
