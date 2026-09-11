# Stripe connection and operations

This runbook prepares the dormant Stripe connector defined by ADR 0002. Do not enable live mode until the activation decision, Shopify catalog contract evidence, isolated end-to-end evidence, tax review, shipping configuration, support ownership, and production secrets are complete.

## Fixed integration contract

- API version: `2026-07-29.dahlia`, pinned by the installed Stripe SDK and checked-in configuration.
- Checkout model: hosted Stripe Checkout Session in `payment` mode.
- Currency: JPY.
- Tax model: `automatic_tax` and the price/shipping `tax_behavior` are configured as one invariant. `inclusive` or `exclusive` requires automatic tax; `unspecified` requires it to be disabled.
- Customer consent: the Checkout terms checkbox is controlled explicitly. `required` is rejected by Stripe unless the account business profile has a valid terms URL.
- Checkout metadata: BloomBox purchase-intent and catalog product identifiers only. Recipient, address, phone, email, and gift message are excluded.
- Customer model: guest-first. A Stripe Customer is not automatically treated as a BloomBox customer account.
- Payment authority: verified Stripe webhook or authenticated Stripe Events API response, never the browser success URL.
- Provider assignment: one PurchaseIntent uses one provider after Checkout creation and cannot switch in flight.
- Redirect authority: Checkout URLs must be HTTPS and use `checkout.stripe.com` or one explicitly configured custom Checkout hostname. Mode and Session ID prefixes must agree.

## Account-side setup

Create and record the owner for each resource in the private credential inventory:

1. A Stripe test account and a separate live account or mode-specific access policy.
2. Separate restricted server keys. The application key has Checkout Session write/read access. The worker key has Event read access. They must not be the same key. Restricted keys beginning with `rk_test_` or `rk_live_` are supported; publishable keys are not.
3. One shipping rate for Japan. Record its `shr_` identifier as `STRIPE_SHIPPING_RATE_ID`.
4. A reviewed `inclusive`, `exclusive`, or `unspecified` tax behavior. The shipping-rate behavior must match the price behavior. Enable Stripe Tax for explicit tax behavior and confirm the public price copy agrees.
5. A business-profile terms URL before setting `STRIPE_TERMS_ACCEPTANCE=required`. Configure payment receipts and branding in the Dashboard; these Dashboard-only settings remain a manual review item.
6. A webhook endpoint at `/api/webhooks/stripe`, pinned to the API version above and subscribed only to:
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
7. The webhook signing secret and expected `acct_` account ID.

Direct Stripe payment must not be activated until the provider activation ADR defines how Shopify-authoritative inventory is reserved before payment and reconciled after cancellation, expiry, refund, and provider outage. The current connector deliberately does not invent an inventory write policy.

## Runtime configuration

Application runtime:

```text
BLOOMBOX_RUNTIME_MODE=production
BLOOMBOX_CHECKOUT_PROVIDER=stripe
BLOOMBOX_CHECKOUT_INTAKE_ENABLED=true
BLOOMBOX_PUBLIC_ORIGIN=https://<production-origin>
SHOPIFY_STORE_DOMAIN=<shop>.myshopify.com
SHOPIFY_STOREFRONT_ACCESS_TOKEN=<storefront-access-token>
SHOPIFY_CATALOG_TAG=bloombox
DATABASE_URL=<least-privilege-application-url>
DATABASE_SSL_MODE=verify-full
DATABASE_MAX_CONNECTIONS=5
BLOOMBOX_PII_KEYRING=<versioned-keyring-json>
STRIPE_MODE=test
STRIPE_CHECKOUT_SECRET_KEY=<restricted-test-checkout-key>
STRIPE_RECONCILIATION_SECRET_KEY=<restricted-test-events-key>
STRIPE_WEBHOOK_SECRET=<test-webhook-secret>
STRIPE_ACCOUNT_ID=<expected-account-id>
STRIPE_SHIPPING_RATE_ID=<shipping-rate-id>
STRIPE_TAX_BEHAVIOR=<inclusive|exclusive|unspecified>
STRIPE_AUTOMATIC_TAX_ENABLED=<true|false>
STRIPE_TERMS_ACCEPTANCE=<required|none>
# STRIPE_CHECKOUT_CUSTOM_DOMAIN=<exact-hostname-without-scheme>
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

## Automated Test Mode account verification

The `Stripe Test Mode Readiness` workflow is a manual, account-backed gate using the protected `stripe-test` GitHub Environment. In addition to the runtime keys above, configure a third, test-only `STRIPE_READINESS_SECRET_KEY`. It needs read access to the current Account, Shipping Rates, Webhook Endpoints, and Tax Settings. It is not deployed with the application.

Configure these Environment values:

```text
Secret: STRIPE_CHECKOUT_SECRET_KEY
Secret: STRIPE_RECONCILIATION_SECRET_KEY
Secret: STRIPE_READINESS_SECRET_KEY
Secret: STRIPE_WEBHOOK_SECRET
Variable: STRIPE_TEST_PUBLIC_ORIGIN
Variable: STRIPE_ACCOUNT_ID
Variable: STRIPE_SHIPPING_RATE_ID
Variable: STRIPE_TAX_BEHAVIOR
Variable: STRIPE_AUTOMATIC_TAX_ENABLED
Variable: STRIPE_TERMS_ACCEPTANCE
Optional variable: STRIPE_CHECKOUT_CUSTOM_DOMAIN
```

The workflow refuses every live credential. It verifies credential separation, account identity, the active JPY shipping rate, matching shipping tax behavior, Stripe Tax readiness, the business-profile terms URL, one exact webhook endpoint, exact event subscriptions, and the pinned endpoint version. It then creates, retrieves, validates, and expires a no-customer-data Checkout Session. The expired Session ID and account contract are written to the workflow summary as evidence.

This probe does not submit a payment method and is not a substitute for the browser E2E matrix below. Run it first so account configuration failures are separated from customer-flow failures.

## Automated flow

1. The server recalculates product price and creates an encrypted PurchaseIntent plus Outbox Event in one PostgreSQL transaction.
2. The Stripe Checkout Session is created outside the database transaction with a deterministic idempotency key.
3. BloomBox records the provider Session ID and API version with an optimistic status predicate.
4. Stripe returns the customer to `/checkout/success`. The page treats the Session ID as a high-entropy capability, reads only BloomBox's PII-free order-status projection, and never treats the browser return as payment confirmation. While the verified event is pending, the page reports processing and refreshes for a bounded period.
5. The signed webhook is verified from the unmodified raw body, minimized, encrypted, and deduplicated in the Inbox before the endpoint acknowledges receipt. No Order or Payment work runs on the request path.
6. The protected worker claims Inbox rows with `SKIP LOCKED`, reclaims stale locks, and uses bounded exponential retry. A paid Checkout event creates exactly one Order, Payment, Attempt, Fulfillment, immutable gift snapshot, balanced ledger transaction, audit record, and Outbox Event in one database transaction. An event moves to `FAILED` after 12 unsuccessful attempts and causes the workflow incident to remain open.
7. Refund and dispute events update their independent entities and payment projection idempotently.
8. GitHub Actions invokes the protected commerce worker every five minutes. It drains the Inbox, reads authenticated Stripe Events with a ten-minute overlap, stores newly discovered events, drains the Inbox again, purges expired transient encrypted payloads, and opens one deduplicated incident issue on failure.

An expired Checkout or an asynchronous payment failure leaves no Order and moves the PurchaseIntent to a terminal state. The return page displays the specific non-charge state and links to a fresh purchase flow for the same catalog product instead of remaining indefinitely in “processing.”

Webhook payloads and terminal PurchaseIntent personal data are cryptographically protected at rest and purged after 30 days. Unstarted PurchaseIntents are automatically expired after 24 hours with an Outbox Event and audit record. Confirmed Order gift and delivery snapshots follow the separately approved order-retention policy and are not deleted by this transient-data job.

## Test-mode activation evidence

Before changing `STRIPE_MODE` to `live`, record all of the following in the activation PR:

- a successful `Stripe Test Mode Readiness` workflow run for the exact test deployment revision;
- successful, failed, canceled, expired, and asynchronous Checkout Sessions;
- duplicate form submission, provider timeout after Session creation, duplicate Webhook, invalid signature, delayed delivery, and reversed event order;
- full and partial refund, failed refund, dispute opened and dispute closed;
- changed price, unavailable catalog item, shipping-rate failure, and tax configuration mismatch;
- concurrent buyers, the approved inventory reservation policy, reservation release, and Shopify inventory reconciliation;
- encrypted address and gift data, log inspection, retention expiry, access controls, and data-subject workflow;
- database backup restoration, frontend rollback, Inbox retry, Event reconciliation, and incident alert recovery;
- Stripe Dashboard totals reconciled to BloomBox Payment, Refund, and Ledger records.

Use Stripe test payment methods only in a Stripe Sandbox/Test Mode. Never test with real payment details in live mode. A browser E2E is considered complete only after the verified webhook has created the BloomBox Order and the customer return page shows the same display ID and total.

## Emergency controls

- Stop new purchase intake by setting `BLOOMBOX_CHECKOUT_INTAKE_ENABLED=false` and deploying this setting to every application instance. Keep `BLOOMBOX_CHECKOUT_PROVIDER=stripe`, the production runtime, provider credentials, and reconciliation schedule unchanged. Never change the provider of an in-flight PurchaseIntent.
- The intake flag defaults to `true` for backward compatibility and accepts only the strings `true` or `false`. Invalid values reject purchase intake but do not disable settlement services. Purchase-intent creation and Checkout initiation check the flag on each invocation; Checkout checks again before creating an external Session. Paused submissions return a customer-facing message without a draft or Checkout URL, preserving the cart for retry.
- This is a deployment-scoped control, not a distributed instantaneous cancellation. Requests already sent to Stripe and previously issued Checkout URLs may still complete. Persist their returned Session references and continue receiving verified events. If existing Sessions must be expired, handle that separately through the provider under an approved incident procedure; do not abandon accepted payment facts.
- Keep the Webhook endpoint and reconciliation worker available while checkout creation is disabled so accepted payments continue to settle into Order and support records.
- Before reopening, verify a paused submission creates no new intent or Session, verify delayed/duplicate events still settle, and confirm reconciliation is healthy. Set `BLOOMBOX_CHECKOUT_INTAKE_ENABLED=true` on all instances to resume. A customer may retry the same request; existing idempotency rules remain in force. Do not roll back to a revision without this control while relying on the flag to stop intake.
- For uncertain payment state, query Stripe by the stored Session or PaymentIntent ID and reconcile; never create a replacement charge speculatively.
- Rotate an exposed Stripe or worker secret immediately, update the protected environment, and replay only verified provider events.
- Roll application code back independently of the database. Correct applied schemas with a new forward migration and never delete accepted commerce facts.
