# BloomBox Architecture

Read this document only when a change affects module ownership, dependencies, state, persistence, transactions, providers, or the commerce critical path.

## System shape

BloomBox is a Modular Monolith. This keeps domain evolution, transactions, deployment, testing, and operations simple while the product is still being validated. A service split requires measured need and an approved ADR.

```text
Browser / external caller
          ↓
Presentation (Next.js, route handlers, server actions)
          ↓
Application (commands, queries, orchestration)
          ↓
Domain (rules, state, interfaces)
          ↑
Infrastructure (database and provider implementations)
```

Dependencies point inward. Domain imports no Next.js, React, filesystem, HTTP client, database client, or vendor SDK. Application may depend on domain interfaces, never infrastructure implementations. Composition occurs at the outer boundary.

## Module ownership

Expected business modules include catalog, gift, flower, customer, recipient, order, payment, inventory, fulfillment, story, notification, and AI. Create a module only when behavior and ownership justify it; the list is not a scaffolding requirement.

A module owns its state and invariants. Cross-module behavior goes through an application service, an exposed interface, or a domain event. One module must not update another module's tables directly.

Never collapse these models:

- Order, Payment, and Fulfillment
- Buyer and Recipient
- Product, Flower, and FlowerLot
- Customer and User
- Gift and Order

## Layers and behavior

- Presentation validates transport input and translates results to UI/API responses.
- Application defines commands and read-only queries, owns orchestration, and sets transaction boundaries.
- Domain defines entities, value objects, transitions, policies, events, and repository/provider interfaces.
- Infrastructure implements persistence and external providers.

Queries have no hidden side effects. Commands express an intended state change. Domain objects are not ORM records, and persistence representations do not leak into the domain.

Vendor SDKs remain in infrastructure. Payment, email, AI, storage, and shipping are accessed through narrow capability-oriented interfaces.

## State and source of truth

Order, Payment, and Fulfillment have independent explicit state machines with validated transition tables. Provider facts cause commands or events; they do not synchronize boolean flags across models.

- PostgreSQL is the future production source of truth for internal commerce state; the current in-memory repositories are replaceable development adapters.
- A verified payment webhook is authoritative for payment success. A browser redirect is not.
- Inventory changes are traceable movements such as received, reserved, released, consumed, or adjusted.
- Public identifiers are opaque; database sequences are not exposed.
- An eGift claim URL is a capability: store only a token hash and enforce expiry, single use, rate limiting, and auditability.
- Timestamps are stored in UTC. Delivery-day rules specify `Asia/Tokyo` explicitly.
- Money uses integer minor units and an explicit currency. The server recalculates totals and order items retain price snapshots.

## Consistency and side effects

A single business operation groups consistency-dependent database writes in one transaction. For example, order creation may include items, price snapshots, inventory reservation, and an outbox record.

Do not hold a database transaction open while calling Stripe, email, AI, or shipping providers. When committed state triggers external work, use an outbox where losing or duplicating the effect would matter.

External and scheduled handlers assume retries, duplicates, delays, timeouts, rate limits, and out-of-order delivery. Idempotency keys and stored processing results must prevent duplicate charges, refunds, shipments, inventory deductions, and notifications.

## Critical path

```text
Browse → Gift configuration → Checkout → Payment → Order → Fulfillment
```

AI, analytics, recommendation, marketing, CMS, and story enrichment are noncritical. Their outage must not prevent checkout or corrupt commerce state. AI output is validated, receives only the minimum necessary data, and never decides price, payment, refund, inventory, shipment, or legal facts. Customer-facing prompts are centralized and versioned.

## ADR threshold

Create or update an ADR before materially changing architecture style, module ownership, database/ORM, hosting, authentication, payment provider, queue/outbox strategy, CMS, AI provider strategy, or a critical trust boundary.

An ADR states context, decision, alternatives, consequences, rollout, and rollback. Routine implementation within existing boundaries does not need an ADR.

## Architecture decision test

Before a material change, answer:

1. Which domain owns the behavior and state?
2. What is authoritative?
3. Which transition occurs?
4. What happens on retry, duplicate execution, or provider failure?
5. What is atomic, and what is eventually consistent?
6. Does the change cross a privacy or authorization boundary?
7. Is a smaller reversible design sufficient?
