# ADR 0002: Commerce persistence and payment-ready boundaries

- Status: Accepted
- Date: 2026-08-21
- Owners: Product and Architecture
- Extends: ADR 0001

## Context

The preview application currently creates an in-memory object named `Order` before checkout. Its state machine also combines order, payment, refund, and fulfillment states. Persisting that model would make retries, partial refunds, split fulfillment, provider reconciliation, and customer support ambiguous.

BloomBox needs durable gift configuration and an auditable integration boundary. It also needs to be ready for a future direct Stripe connection without weakening ADR 0001's current Shopify-first production boundary. Provider credentials and test-store evidence are not yet available, so live commerce activation remains out of scope.

## Decision

BloomBox remains a Modular Monolith and introduces four independent lifecycle owners:

- Checkout owns `PurchaseIntent`, the mutable pre-purchase gift configuration and provider handoff.
- Order owns the accepted purchase contract and its confirmation or cancellation lifecycle.
- Payment owns attempts, captures, refunds, and disputes.
- Fulfillment owns preparation, shipment, delivery, cancellation, and returns.

PostgreSQL will be the durable store for BloomBox-owned intents, provider mappings, idempotency records, webhook inbox entries, outbox events, operational projections, consent, and audit history. While ADR 0001 remains active, Shopify continues to be authoritative for catalog, price, availability, checkout, payment, orders, refunds, and inventory. Provider-originated commerce facts are mirrored; they are not silently overwritten by BloomBox.

Provider integrations use narrow application-owned ports. A Stripe adapter may be implemented and tested in a disabled state, but activating direct Stripe payment requires a separate activation ADR covering the merchant of record, tax, inventory ownership, reconciliation, incident response, migration cohorts, and rollback. A purchase intent is assigned to exactly one commerce provider before external checkout creation, and that provider cannot change after the first attempt.

## Persistence rules

- Domain entities are not database rows and contain no database or provider SDK types.
- Purchase-time product, price, recipient, address, and gift data are immutable snapshots after order acceptance.
- Money is stored as integer minor units with an explicit currency.
- Order, payment, refund, fulfillment, ledger, and transition facts are not physically deleted.
- Buyer, recipient, and customer identity remain distinct. A recipient is not enrolled as a customer without explicit consent.
- External calls never occur inside a database transaction.
- Reliable post-commit effects use an outbox. Incoming provider events are verified, inserted into an inbox with a unique provider event identifier, acknowledged quickly, and processed asynchronously.
- Handlers tolerate retries, duplicates, delay, and reordering. Scheduled reconciliation repairs missing or stale provider projections.
- Sensitive payloads are minimized, encrypted where retention is required, and excluded from logs and provider metadata.

Offline recovery of an exhausted Inbox event now uses a Payment-owned DB-owner PLAN/APPLY command, following the existing owner-maintenance pattern. A short-lived, content-bound plan and protected immutable audit receipt authorize one FAILED-to-PENDING retry budget reset. Runtime credentials cannot issue this command or forge its receipt. Queue state and receipt commit together; repeat requests consult the receipt without resetting work that has since progressed. This does not authorize commerce mutations, decrypt payloads, bypass worker idempotency, extend retention or activate Shopify. See [recovery scope and rollback](../../operations/WEBHOOK_RETRY.md).

## Alternatives considered

### Persist the existing Order aggregate

Rejected because a single status cannot accurately represent independent payment and fulfillment progress. It would also incorrectly treat an unaccepted checkout draft as an order.

### Build a Stripe-first commerce core immediately

Rejected for activation because credentials, provider-side configuration, inventory ownership, tax behavior, and operational evidence are not available. Implementing a disabled adapter behind a stable port is reversible; making it authoritative is not.

### Adopt microservices or full event sourcing

Rejected because current scale does not justify distributed transactions or the operational burden. PostgreSQL state plus append-only transition history, inbox, and outbox provides the required auditability and recovery path.

## Consequences

- The preview UI creates a `PurchaseIntent`, not an `Order`.
- An `Order` is created only from an accepted authoritative commerce fact.
- Payment and fulfillment status are queried independently and may be combined only in read models.
- PostgreSQL migrations, backup restoration, provider contract tests, webhook failure tests, and reconciliation evidence become L3 release requirements.
- Production commerce remains blocked until the active provider adapters and environment controls satisfy the release checklist.

## Rollout

1. Split the domain state machines and rename the preview write to `PurchaseIntent`.
2. Add PostgreSQL schema, migrations, least-privilege configuration, and persistence adapters.
3. Add inbox, outbox, idempotency, worker, reconciliation, and observability paths.
4. Add Shopify adapters and sanitized contract fixtures for the active production boundary.
5. Add a disabled Stripe adapter, Checkout Session boundary, verified webhook endpoint, and contract tests.
6. Activate a provider only after credentials, isolated test environments, critical-flow E2E evidence, and a reviewed activation ADR exist.

## Rollback

Each rollout step is additive. Before live commerce, rollback by reverting the application deployment while retaining migration history. After persistence is active, use forward corrective migrations; never delete accepted commerce facts. A failed provider rollout returns new purchase intents to the previously approved provider and leaves in-flight intents with their originally assigned provider.

## Verification

- Domain tests prove independent transition tables and terminal behavior.
- Architecture checks prevent provider and persistence types from entering Domain.
- Migration verification checks ordering, checksums, constraints, and repeat execution.
- Integration tests cover atomic writes, concurrency, duplicate commands, and rollback.
- Provider tests cover signature failure, duplicate and reordered events, timeouts, retries, and reconciliation.
