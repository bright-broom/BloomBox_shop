# ADR 0005: Scoped operator approval evidence

Status: Proposed for production; implemented only as a disconnected internal capability.

Date: 2026-09-12. Supersedes: None.

## Context

Fulfillment intake can verify paid, untouched orders and allocated stock, but cannot infer a human's authority. Customer identities and webhook credentials are not operator authorization. No operator authentication provider has been selected or connected.

## Decision

Fulfillment owns a narrow, shop-scoped approval permission and immutable approval receipts in PostgreSQL. A request-bound, server-injected identity port must verify the operator's session and map it to an opaque UUID; caller-supplied operator IDs, role flags, customer sessions, and worker tokens are not identity adapters. Missing identity denies access. This port does not select a provider or implement login.

A separate NOLOGIN database role can read prerequisites, lock their immutable identity columns, and append approval/audit/Outbox records. It cannot change money, fulfillment status, permission scope, validity, or approval history. Permission provisioning/revocation requires the database owner, records every revision in audit, and has no public route or seeded grants. Identity-provider mapping and an authenticated administration flow remain activation prerequisites.

The internal review query uses the same request-bound identity and permission boundary. It returns a minimal read-only DTO, excluding buyer/recipient identity, protected fields and approval capabilities. Its storefront-accessible preview uses synthetic data only and is disabled in production runtime. The user selected a Google account for future operator login; OAuth configuration and the verified identity adapter remain unconnected.

Approval locks the permission and the same payment parent used by reconciliation, then checks the exact intake version reviewed by the operator. It locks current order, payment, projection, gift and fulfillment rows and re-evaluates existing intake, quantity and stock rules. Changed evidence, revoked/expired permission, expired stock or identity, changed payment, missing protected delivery data and pending merchant policy deny approval. The record expires no later than its stock, identity, permission or protected-address evidence. An idempotency key belongs to one operator and one reviewed intake; retries revalidate prerequisites and never refresh expiry or create another record.

Approval records a decision at a point in time; it is not a dispatch capability. No shipment, status transition, provider mutation or notification follows this event. A future dispatch command must reauthenticate, reauthorize and reread current provider evidence; neither an approval ID nor an Outbox event authorizes shipping.

## Alternatives and consequences

- A client `isAdmin` flag or a shared worker credential cannot establish a human principal.
- A full identity platform now would choose an unapproved vendor and introduce unnecessary infrastructure. A narrow port keeps that decision explicit.
- Separate authorization and approval transactions would permit permission revocation and evidence changes between validation and persistence. Row locks serialize local changes; they cannot make Shopify and PostgreSQL one atomic system.
- Short-lived stock evidence can expire while a person reviews it. Refreshing evidence requires reviewing the new intake version, not silently reusing a previous decision.

## Rollout and rollback

Migration 0014 is additive. Keep the capability disconnected and the default policy pending. Production needs authenticated identity mapping/session revocation, audited permission administration, a review screen with CSRF/rate-limit protections, real-store/warehouse tests and a separately designed dispatch command. Synthetic tests do not approve merchant terms or actual operators.

Rollback disables composition of the approval capability. Retain the forward migration, receipts and audit; never delete approval history or downgrade migration checksums.

## Verification

`pnpm check:ci` passes (579 ordinary tests, type/lint/static checks and build). The isolated PostgreSQL suite passes 81 tests, including all 14 migrations applied twice, dedicated-role permissions, concurrent approval, actual permission/payment lock waits, clock expiry after waiting, mismatched order update versions, immutable receipts and atomic Outbox failure recovery. These are local synthetic checks, not production identity or warehouse E2E evidence.
