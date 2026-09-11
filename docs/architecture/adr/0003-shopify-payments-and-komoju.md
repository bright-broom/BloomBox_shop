# ADR 0003: Shopify Checkout with Shopify Payments and KOMOJU

- Status: Accepted for implementation; production activation remains blocked
- Date: 2026-09-11
- Owners: Product / Architecture / Engineering
- Extends: ADR 0001 and ADR 0002
- Decision authority: The product owner's request to integrate KOMOJU, or select a better alternative, to maximize useful payment coverage. This is not evidence of merchant approval or a live launch.

## Context

BloomBox serves Japanese gift purchases, with JPY prices and domestic delivery. The owner wants broad payment coverage. Shopify already owns the production catalog and is the approved commerce source of truth. The application currently has a disabled direct Stripe path, but no Shopify checkout orchestration or Shopify order-event processor.

## Decision

Use Shopify-hosted Checkout with Shopify Payments for cards and accelerated wallets, supplemented by KOMOJU's official Shopify payment apps for eligible domestic alternatives. Consider PayPal separately through Shopify. Keep one purchase intent attached to one Shopify commerce flow; do not create a second payment independently in KOMOJU or Stripe for the same purchase.

- Checkout owns purchase-intent creation and the Shopify cart handoff. Shopify owns final price, tax, shipping, checkout, payment, order, refund, and inventory facts. Payment apps configure which methods Shopify Checkout offers.
- KOMOJU handles its payment methods underneath Shopify. BloomBox does not need a direct KOMOJU secret key for this integration and does not write to KOMOJU to duplicate Shopify payment operations.
- The Shopify cart transport and response shapes remain in Checkout infrastructure. No vendor types enter Domain.
- The cart carries only an opaque purchase-intent reference. Recipient name, gift message, and buyer information are not copied into cart attributes. The reference is correlation, not proof of ownership or payment.
- A returned checkout URL is a handoff, not an order or successful payment. Only verified Shopify facts may update accepted order/payment projections.
- Offer methods actually approved and tested for this merchant, currency, location, device, and product. Do not advertise the provider's global method count as this store's availability.

## Alternatives considered

| Option | Assessment for BloomBox |
| --- | --- |
| Shopify Payments + KOMOJU | Selected. Keeps existing commerce ownership, adds domestic alternatives through supported payment apps, and avoids building a second commerce core. Adds provider fees and app-specific operational checks. |
| Shopify Payments alone | Simplest baseline for cards, Apple Pay, Google Pay, and Shop Pay, but does not satisfy the requested breadth of Japanese alternatives. |
| Direct Stripe Checkout | Existing disabled code is reusable, and Stripe supports PayPay as well as convenience-store payments. Rejected for activation here because it changes the approved commerce boundary and does not establish broader Japanese coverage than the selected combination. |
| SB Payment Service | Credible Shopify-compatible alternative. Reconsider if its merchant-specific coverage, quote, support, or settlement conditions outperform KOMOJU. No merchant quote has been obtained. |
| GMO Payment Gateway | Broad payment offering and a potential alternative at scale. Its published FAQ describes setup, fixed monthly, and processing fees. No account-specific integration/fee advantage has been established for BloomBox. |
| Direct KOMOJU API | Useful for a standalone custom commerce system; unnecessary when using the supported Shopify apps. It would transfer order/payment/inventory coordination to BloomBox. |

Sources checked on 2026-09-11: [Shopify payment methods in Japan](https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries/japan/payment-methods), [KOMOJU Shopify integration](https://doc.komoju.com/docs/getting-started-with-shopify), [Stripe Japan guide](https://support.stripe.com/questions/getting-started-with-stripe-a-guide-for-users-in-japan?locale=ja-JP), [SBPS Shopify](https://www.sbpayment.jp/service/partner/shopify/lp01/), [GMO-PG FAQ](https://www.gmo-pg.com/faq/).

## Consequences

- Payment method installation and merchant screening are account work; adding an application enum or a logo does not enable payment.
- KOMOJU processing fees and Shopify third-party transaction fees can both apply. Compare the combined cost, including refunds and payout charges, using the actual Shopify plan and merchant agreement.
- Convenience-store, bank, and other delayed payments need an explicit payment deadline and delivery policy. A checkout return or pending payment must never start flower preparation. If payment arrives too late for the requested date, hold fulfillment and resolve delivery/refund with the buyer.
- Shopify cart creation must not inherit Stripe's idempotency or expiry assumptions. An uncertain response does not prove that no cart was created. The existing 24-hour PurchaseIntent expiry does not invalidate a Shopify cart or pending payment.
- Full cart IDs contain a secret key. Store them encrypted; omit them and checkout URLs from logs, URLs owned by BloomBox, and analytics. Never store them in the existing plaintext external checkout column without a protection change.

## Rollout

1. Implement a disabled Shopify cart create/retrieve boundary with validation, bounded response size, no automatic mutation retry, and contract fixtures. This is the scope implemented with this ADR.
2. Implement a durable, concurrent-safe checkout-attempt claim before calling Shopify. Save the provider before the first attempt, encrypt recovered cart credentials, and persist an uncertain state on ambiguous outcomes. Repeated requests retrieve a known cart; they must not silently create another cart or switch providers. This requires a forward migration and database failure tests.
3. Implement verified Shopify event ingestion, provider-scoped inbox processing, order/payment/fulfillment projection, and scheduled reconciliation. Process pending, paid, failed, canceled, and refunded states independently, including reordered and duplicate notifications. Provider attributes alone do not authorize linking an order to an intent.
4. Finish buyer/recipient delivery handling, inventory and delayed-payment deadlines. Review whether Shopify checkout validation is needed to enforce requested delivery and changed cart contents. Never assume a pre-handoff check constrains later Shopify edits.
5. Connect merchant-approved payment apps in an isolated test store; record per-method success, failure, cancel, expiry, late payment, and refund evidence using the runbook below.
6. Replace the Stripe-specific activation requirements with the selected Shopify flow only once that flow is implemented. Complete release evidence and activate through the protected release process. No live switch is made by this ADR.

## Rollback

Before activation, revert the new disconnected adapter without changing checkout behavior. After activation, stop new checkout intake while keeping Shopify notifications and reconciliation running for existing purchases. Keep each in-flight purchase with Shopify, preserve accepted orders and payment facts, and use a verified Shopify-hosted fallback if required. Do not switch existing purchases to direct Stripe or KOMOJU. Retain migration history and use forward fixes for persisted data.

## Implementation progress — 2026-09-11

Rollout step 2 now has a disconnected application workflow and a PostgreSQL attempt repository: durable provider/attempt claim, encrypted cart credentials, transactional intent transition/audit/Outbox, safe retrieval, and conservative UNKNOWN handling. The expiring CheckoutSession workflow is Stripe-only and also pins its provider before I/O. Result-unknown reconciliation, ownership authorization, retention completion, verified order processing and live wiring remain pending. See [implementation and migration evidence](../../operations/SHOPIFY_CHECKOUT_ATTEMPTS.md).

Rollout step 3 now has disabled-by-default signed webhook capture and provider/account-scoped encrypted Inbox storage. It stores minimal order/refund references, deduplicates by body digest rather than unsigned headers, and does not project commerce state. A disconnected Admin API reader now validates the pinned shop, reference identity, complete bounded line/transaction collections, JPY money, and current order/refund facts. An internal association workflow now compares the authenticated Order.cartToken with a scoped digest of the saved cart token and checks the persisted variant, quantity, JPY price, provider and API version. Checkout owns immutable links, atomic audit/Outbox writes, and one-to-one constraints (migration 0006). Provider attributes alone do not authorize an association; projection and real-store token-format evidence remain pending. See [association](../../operations/SHOPIFY_ORDER_LINKS.md). See [read boundary](../../operations/SHOPIFY_ORDER_READS.md). Processing, reconciliation, retention completion, and real-store evidence remain pending. See [webhook capture](../../operations/SHOPIFY_WEBHOOKS.md).

Payment now records a validated settlement observation for a linked Shopify order (migration 0007). This Payment-owned evidence is intentionally separate from accepted local Order/Payment/Fulfillment records: those still require final pricing, delivery and gift acceptance, and must not be fabricated from display status. Complete bounded transaction lists, parent relationships, matching provider totals, immutable success facts, and transactional audit/Outbox protect concurrent and reordered updates. The workflow remains disconnected; no Inbox completion or live activation is implied. See [payment evidence](../../operations/SHOPIFY_PAYMENT_EVIDENCE.md).

Rollout step 4 now includes a disconnected destination assessment after settlement persistence, pricing and timing checks. Protected shipping-address fields are fetched only under approved coverage, through a separate bounded read; raw address text stays inside Infrastructure and only a Fulfillment-owned structural/coverage result leaves it. Denied protected-data access does not erase payment evidence. Coverage remains unapproved. An optional acceptance gateway now connects a final protected-address read to Order persistence; shipping authorization remains pending. This implements the existing delivery-handling decision without adding a new provider or system of record. See [destination validation](../../operations/SHOPIFY_DELIVERY_DESTINATION.md).

Order now has a disconnected atomic acceptance adapter (migration 0008): a confirmed order, item taxes, order-bound encrypted gift/address snapshot, immutable acceptance receipt, transition, audit and Outbox. It locks and reads Checkout/Payment facts without mutating their tables. Default terms remain PENDING; synthetic approved policies exercise concurrency, refunds racing acceptance, tax storage, privacy and rollback. ReconcileShopifyPayment now optionally invokes an acceptance gateway after its existing assessments. Infrastructure fetches bounded address2/phone fields, checks the source update timestamp again, and passes plaintext only to the Order persistence command; Application results contain only IDs and reason codes. Settlement and order acceptance outcomes stay separate, so later failure does not erase earlier financial evidence and retries can resume. Checkout conversion and Payment projection now run through separate owner commands after acceptance (migration 0009). An immutable accepted-order lookup resumes partial completion and processes later refunds without requiring current cart contents or retained PII. Payment projects current durable capture/refund evidence, balanced operational ledger entries and a monotonic projection version atomically; Checkout then converts the purchase intent with its own audit/Outbox. The scoped external payment reference represents the order aggregate, not a provider charge ID. Fulfillment now records a local held intake and cancellation for untouched intake under cancellation/full-refund facts (migration 0010). Its owner transaction verifies current Payment projection, stores decision versions/audit/Outbox and never authorizes dispatch without inventory integration. Active or shipped records retain their state with a review reason; no warehouse/provider cancellation is implied. See [fulfillment intake](../../operations/SHOPIFY_FULFILLMENT_INTAKE.md). An optional authenticated fulfillment reader now persists a monotonic activity witness in the Fulfillment intake transaction (migration 0011); any recorded external activity holds cancellation, including after local cancellation. This is evidence about any part of the order, not a whole-order shipping/delivery projection. Missing readers cannot authorize new cancellation; timeouts or malformed/partial responses retry without erasing prior commerce writes. A separate quantity assessment now compares complete order/fulfillment lines with accepted Order item snapshots (migration 0012), distinguishing partial shipping/delivery and rejecting excess, unknown items, stale or contradictory revisions. It preserves prior quantity evidence on incomplete reads and never changes operational fulfillment state or authorizes dispatch. See [quantity reconciliation](../../operations/SHOPIFY_FULFILLMENT_QUANTITIES.md). Inventory/dispatch approval, individual refund details, accepted-order retention, authorization, public/Inbox wiring and real-store E2E remain pending. See [completion and recovery](../../operations/SHOPIFY_ORDER_COMPLETION.md). See [order acceptance](../../operations/SHOPIFY_ORDER_ACCEPTANCE.md).

## Verification

Implementation references: [Cart creation](https://shopify.dev/docs/api/storefront/2026-07/mutations/cartCreate), [cart token handling](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage), and [API version response headers](https://shopify.dev/docs/api/usage/versioning).

Local adapter tests cover reference/variant/quantity/JPY-price mismatch, unexpected lines, provider errors and warnings, unsafe redirects, oversized responses, network failures, timeout, non-retried writes, repeated read-only retrieval, and PII minimization. These are synthetic contract fixtures, not merchant-backed end-to-end evidence. The adapter deliberately does not implement the existing expiring CheckoutSession interface or enter the composition root yet.

Account settings and final activation evidence are tracked in [KOMOJU and Shopify payment rollout](../../operations/PAYMENTS.md). No account approval, live payment availability, or successful Shopify/KOMOJU transaction is claimed.
