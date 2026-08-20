# ADR 0001: Shopify-first commerce boundary

- Status: Accepted
- Date: 2026-08-20
- Owners: Product and Architecture
- Supersedes: The undocumented PostgreSQL and Stripe direction

## Context

BloomBox needs to validate a differentiated gift experience while keeping catalog, inventory, checkout, payment, order, privacy, refund, and fulfillment operations reliable. Building those commodity commerce capabilities independently would create security, compliance, reconciliation, and support work before the product has evidence that custom infrastructure is necessary.

The current application uses JSON catalog content and in-memory order storage. Those adapters are useful for experience development but cannot safely accept production orders: serverless instances do not share process memory, and a redirect may reach a different instance.

## Decision

Shopify is the production commerce system of record for:

- sellable products and variants;
- price and availability;
- inventory;
- cart and checkout;
- payment status;
- orders, refunds, and commerce-related customer records.

The BloomBox Next.js application owns:

- discovery and the branded gift journey;
- gift configuration before checkout;
- editorial story and producer context;
- customer-facing copy and presentation;
- optional message assistance that cannot block checkout.

BloomBox accesses Shopify through narrow infrastructure adapters. Shopify SDK types, GraphQL payloads, and webhook shapes do not enter domain models. Boundary data is runtime-validated and mapped to module-owned types. Cross-module consumers import only a module's `public.ts` entry point.

The repository's JSON catalog and in-memory order repository are preview fixtures only. `pnpm check:production` must fail while either is composed into the application. A custom PostgreSQL commerce store or direct Stripe integration requires a superseding ADR with evidence, ownership, migration, reconciliation, incident response, and rollback plans.

## Alternatives considered

### Custom PostgreSQL and Stripe commerce core

This gives maximum control but makes BloomBox responsible for payment webhooks, order reconciliation, refunds, inventory consistency, privacy operations, and continuous on-call ownership. Current product requirements do not justify that cost.

### Shopify-hosted storefront only

This minimizes application code but constrains the differentiated gift configuration and editorial experience. It remains a valid fallback if the custom frontend does not create measurable value.

### Shopify as commerce core with a BloomBox experience layer

This preserves the product's differentiated surface while delegating established commerce responsibilities. It has integration and platform-dependency costs, but is the smallest reversible production architecture.

## Consequences

- Catalog changes are made in Shopify and consumed through an adapter; checked-in JSON remains deterministic preview data.
- Prices and availability displayed before checkout are advisory until Shopify confirms them server-side.
- Checkout completion and payment state come from verified Shopify facts, never from browser parameters.
- Gift metadata sent to Shopify must be minimized, documented, and covered by retention and privacy rules.
- Shopify outage handling, API version upgrades, rate limits, webhook retries, and reconciliation become explicit operational responsibilities.
- The application remains a Modular Monolith. Shopify integration does not justify microservices.

## Rollout

1. Define validated catalog and checkout ports owned by the relevant application layer.
2. Implement Shopify infrastructure adapters and contract tests against recorded, sanitized fixtures.
3. Replace the in-memory order handoff with Shopify cart or draft-order metadata approved by the product flow.
4. Verify webhook signatures, idempotency, retry handling, reconciliation, observability, and privacy behavior.
5. Add critical-flow E2E evidence in a Shopify test store.
6. Remove both blockers reported by `pnpm check:production` before enabling production deployment.

## Rollback

Before accepting live orders, roll back by disabling the production deployment and continuing with preview fixtures. After launch, rollback must preserve Shopify as the commerce source of truth; the BloomBox experience can fall back to a Shopify-hosted storefront or a known-good frontend deployment without deleting or rewriting accepted orders.

## Verification

- Architecture checks prevent vendor leakage and private cross-module imports.
- Contract tests validate Shopify payload mapping and failure behavior.
- E2E tests cover cart creation, checkout handoff, duplicate execution, changed price, unavailable inventory, and provider failure.
- Production release automation runs the full CI suite, dependency audit, and production-readiness check before protected-environment approval.
