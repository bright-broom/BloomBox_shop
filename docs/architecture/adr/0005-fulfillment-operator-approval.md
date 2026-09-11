# ADR 0005: Scoped operator approval evidence

Status: Proposed for production; internal capability and authenticated form implemented, with merchant policy pending.

Date: 2026-09-12. Supersedes: None.

## Context

Fulfillment intake can verify paid, untouched orders and allocated stock, but cannot infer a human's authority. Customer identities and webhook credentials are not operator authorization. Google OIDC was subsequently selected in ADR 0006; real credentials and operator grants remain unconfigured.

## Decision

Fulfillment owns a narrow, shop-scoped approval permission and immutable approval receipts in PostgreSQL. A request-bound, server-injected identity port must verify the operator's session and map it to an opaque UUID; caller-supplied operator IDs, role flags, customer sessions, and worker tokens are not identity adapters. Missing identity denies access. This port does not select a provider or implement login.

A separate NOLOGIN database role can read prerequisites, lock their immutable identity columns, and append approval/audit/Outbox records. It cannot change money, fulfillment status, permission scope, validity, or approval history. Permission provisioning/revocation requires the database owner, records every revision in audit, and has no public route or seeded grants. Real identity-provider configuration, explicit operator bindings and an authenticated permission-administration flow remain activation prerequisites.

The internal review query uses the same request-bound identity and permission boundary. It returns a minimal read-only DTO, excluding buyer/recipient identity, protected fields and approval capabilities. Its storefront-accessible preview uses synthetic data only and is disabled in production runtime. ADR 0006 connects the verified Google identity adapter to the scoped inbox, review query and approval form. Real OAuth configuration remains pending.

Approval locks the permission and the same payment parent used by reconciliation, then checks the exact intake version reviewed by the operator. It locks current order, payment, projection, gift and fulfillment rows and re-evaluates existing intake, quantity and stock rules. Changed evidence, revoked/expired permission, expired stock or identity, changed payment, missing protected delivery data and pending merchant policy deny approval. The record expires no later than its stock, identity, permission or protected-address evidence. An idempotency key belongs to one operator and one reviewed intake; retries revalidate prerequisites and never refresh expiry or create another record.

Approval records a decision at a point in time; it is not a dispatch capability. No shipment, status transition, provider mutation or notification follows this event. A future dispatch command must reauthenticate, reauthorize and reread current provider evidence; neither an approval ID nor an Outbox event authorizes shipping.

## Browser submission boundary

The authenticated review page issues an encrypted, purpose-separated JWE only when merchant policy and the review presentation allow it. It binds the exact shop, fulfillment, intake version, operator, session expiry, test/live mode and server-generated idempotency key. Its maximum five-minute lifetime is bounded by the original session and does not extend the thirty-second stock deadline. The Server Action requires explicit acknowledgement, canonical Origin, current authentication and binding, bounded nonduplicated fields, and the unchanged merchant-policy gate before invoking the existing transactional command. Next.js CSRF and body-size protections remain enabled.

A retry retains the same encrypted context; a successful commit remains successful if subsequent view revalidation fails. Refreshing the page rereads stored evidence, not Shopify. This context is neither approval nor dispatch authority. See [operation and verification details](../../operations/OPERATOR_APPROVAL_FORM.md).

## Alternatives and consequences

- A client `isAdmin` flag or a shared worker credential cannot establish a human principal.
- A full identity platform now would choose an unapproved vendor and introduce unnecessary infrastructure. A narrow port keeps that decision explicit.
- Separate authorization and approval transactions would permit permission revocation and evidence changes between validation and persistence. Row locks serialize local changes; they cannot make Shopify and PostgreSQL one atomic system.
- Short-lived stock evidence can expire while a person reviews it. Refreshing evidence requires reviewing the new intake version, not silently reusing a previous decision.

## Rollout and rollback

Migration 0014 is additive. Keep the default policy pending. Production needs real Google configuration and explicit operator bindings, session-revocation assessment, audited permission administration, operation rate limiting, real-store/browser/warehouse tests and a separately designed dispatch command. The authenticated review form and CSRF boundary are implemented; rate limiting is not. Synthetic tests do not approve merchant terms or actual operators.

Rollback disables composition of the approval capability. Retain the forward migration, receipts and audit; never delete approval history or downgrade migration checksums.

## Verification

Original internal-capability verification: `pnpm check:ci` passes (579 ordinary tests, type/lint/static checks and build). The isolated PostgreSQL suite passes 81 tests, including all 14 migrations applied twice, dedicated-role permissions, concurrent approval, actual permission/payment lock waits, clock expiry after waiting, mismatched order update versions, immutable receipts and atomic Outbox failure recovery. These are local synthetic checks, not production identity or warehouse E2E evidence.

Authenticated-form verification: 652 ordinary tests and 90 isolated PostgreSQL tests pass, alongside type/lint/static checks, build and production dependency audit. Encrypted concurrent submissions use the actual approval transaction; real Server Action HTTP checks prove policy/anonymous/foreign-Origin rejection. Browser checks cover the inactive policy and historical preview. Successful approval uses explicit test policy, not real Google or approved merchant terms.
