# Stripe connection and operations

This runbook prepares the dormant Stripe connector defined by ADR 0002. Do not enable live mode until the activation decision, Shopify catalog adapter, isolated end-to-end evidence, tax review, shipping configuration, support ownership, and production secrets are complete.

## Fixed integration contract

- API version: `2026-07-29.dahlia`, pinned by the installed Stripe SDK and checked-in configuration.
- Checkout model: hosted Stripe Checkout Session in `payment` mode.
- Currency: JPY.
- Checkout metadata: BloomBox purchase-intent and catalog product identifiers only. Recipient, address, phone, email, and gift message are excluded.
- Customer model: guest-first. A Stripe Customer is not automatically treated as a BloomBox customer account.
- Payment authority: verified Stripe webhook or authenticated Stripe Events API response, never the browser success URL.
- Provider assignment: one PurchaseIntent uses one provider after Checkout creation and cannot switch in flight.

## Account-side setup

Create and record the owner for each resource in the private credential inventory:

1. A Stripe test account and a separate live account or mode-specific access policy.
2. A restricted secret key with only the Checkout Session, Event, PaymentIntent, Refund, and Dispute permissions required by this connector.
3. One shipping rate for Japan. Record its `shr_` identifier as `STRIPE_SHIPPING_RATE_ID`.
4. A reviewed `inclusive`, `exclusive`, or `unspecified` tax behavior. The public price copy and Stripe tax configuration must agree before live activation.
5. A webhook endpoint at `/api/webhooks/stripe`, pinned to the API version above and subscribed only to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
   - `refund.created`
   - `refund.updated`
   - `refund.failed`
   - `charge.dispute.created`
   - `charge.dispute.closed`
6. The webhook signing secret and expected `acct_` account ID.

## Runtime configuration

Application runtime:

```text
BLOOMBOX_RUNTIME_MODE=production
BLOOMBOX_CHECKOUT_PROVIDER=stripe
BLOOMBOX_PUBLIC_ORIGIN=https://<production-origin>
DATABASE_URL=<least-privilege-application-url>
DATABASE_SSL_MODE=verify-full
DATABASE_MAX_CONNECTIONS=5
BLOOMBOX_PII_KEYRING=<versioned-keyring-json>
STRIPE_MODE=test
STRIPE_SECRET_KEY=<restricted-test-secret>
STRIPE_WEBHOOK_SECRET=<test-webhook-secret>
STRIPE_ACCOUNT_ID=<expected-account-id>
STRIPE_SHIPPING_RATE_ID=<shipping-rate-id>
STRIPE_TAX_BEHAVIOR=<inclusive|exclusive|unspecified>
COMMERCE_WORKER_SECRET=<random-32-plus-character-secret>
```

Worker and GitHub configuration:

```text
DATABASE_WORKER_URL=<least-privilege-worker-url>
GitHub variable: PRODUCTION_BASE_URL
GitHub variable: STRIPE_RECONCILIATION_ENABLED=true
GitHub secret: COMMERCE_WORKER_SECRET
```

The application, worker, migration, test, and live Stripe credentials are separate. Never expose any of them through `NEXT_PUBLIC_*` or Preview Environment inheritance.

## Automated flow

1. The server recalculates product price and creates an encrypted PurchaseIntent plus Outbox Event in one PostgreSQL transaction.
2. The Stripe Checkout Session is created outside the database transaction with a deterministic idempotency key.
3. BloomBox records the provider Session ID and API version with an optimistic status predicate.
4. Stripe returns the customer to `/checkout/success`, which deliberately reports only that verification is in progress.
5. The signed webhook is verified from the unmodified raw body, minimized, encrypted, and deduplicated in the Inbox before the endpoint acknowledges receipt. No Order or Payment work runs on the request path.
6. The protected worker claims Inbox rows with `SKIP LOCKED`, reclaims stale locks, and uses bounded exponential retry. A paid Checkout event creates exactly one Order, Payment, Attempt, Fulfillment, immutable gift snapshot, balanced ledger transaction, audit record, and Outbox Event in one database transaction. An event moves to `FAILED` after 12 unsuccessful attempts and causes the workflow incident to remain open.
7. Refund and dispute events update their independent entities and payment projection idempotently.
8. GitHub Actions invokes the protected commerce worker every five minutes. It drains the Inbox, reads authenticated Stripe Events with a ten-minute overlap, stores newly discovered events, drains the Inbox again, purges expired transient encrypted payloads, and opens one deduplicated incident issue on failure.

Webhook payloads and terminal PurchaseIntent personal data are cryptographically protected at rest and purged after 30 days. Unstarted PurchaseIntents are automatically expired after 24 hours with an Outbox Event and audit record. Confirmed Order gift and delivery snapshots follow the separately approved order-retention policy and are not deleted by this transient-data job.

## Test-mode activation evidence

Before changing `STRIPE_MODE` to `live`, record all of the following in the activation PR:

- successful, failed, canceled, expired, and asynchronous Checkout Sessions;
- duplicate form submission, provider timeout after Session creation, duplicate Webhook, invalid signature, delayed delivery, and reversed event order;
- full and partial refund, failed refund, dispute opened and dispute closed;
- changed price, unavailable catalog item, shipping-rate failure, and tax configuration mismatch;
- encrypted address and gift data, log inspection, retention expiry, access controls, and data-subject workflow;
- database backup restoration, frontend rollback, Inbox retry, Event reconciliation, and incident alert recovery;
- Stripe Dashboard totals reconciled to BloomBox Payment, Refund, and Ledger records.

## Emergency controls

- Stop new Stripe Checkout creation by setting `BLOOMBOX_CHECKOUT_PROVIDER=preview` and deploying the known-good revision. Never change the provider of an in-flight PurchaseIntent.
- Keep the Webhook endpoint and reconciliation worker available while checkout creation is disabled so accepted payments continue to settle into Order and support records.
- For uncertain payment state, query Stripe by the stored Session or PaymentIntent ID and reconcile; never create a replacement charge speculatively.
- Rotate an exposed Stripe or worker secret immediately, update the protected environment, and replay only verified provider events.
- Roll application code back independently of the database. Correct applied schemas with a new forward migration and never delete accepted commerce facts.
