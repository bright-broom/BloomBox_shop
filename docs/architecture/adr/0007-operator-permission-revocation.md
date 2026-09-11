# ADR 0007: Audited operator permission revocation

Status: Proposed for production; internal revocation capability, not a public administration route.

Date: 2026-09-12. Extends ADR 0005 and ADR 0006.

## Decision

Fulfillment owns a distinct, shop-scoped permission-manager grant and immutable revocation receipts. A verified request-bound identity port provides the actor; a browser-supplied actor or an ordinary approval permission cannot establish management authority. Manager grants are owner-provisioned and initially empty. This capability does not create manager grants, assign operators or enable approval permissions.

Revocation requires an explicit reason, exact reviewed permission version and idempotency key. It locks the active manager grant before the target permission, checks database time after lock waits, and atomically disables the target, writes the actor-attributed receipt and appends OPERATOR audit. Existing SYSTEM revision audit remains intact. Replays reauthorize the manager and cannot revoke a subsequently re-enabled version. No notification, dispatch or Outbox effect is required: the existing authorization queries observe the disabled permission directly.

A separate NOLOGIN database role has prerequisite reads/identity-column locks and append-only receipt/audit writes. A narrowly scoped SECURITY DEFINER SQL function can only disable an enabled target with the matching version; it cannot enable, create or reassign a permission. Its search path is fixed, all application objects are schema-qualified and PUBLIC execution is revoked. General application, worker and fulfillment-approver roles gain no management rights. The database credential is a trusted infrastructure boundary, not a substitute for application-level manager authorization.

## Consequences and rollout

Migration 0016 adds manager grants, immutable receipts and the restricted disable function. Apply it and reapply dedicated role grants before composing the capability. Manager provisioning remains a privileged, SYSTEM-audited bootstrap operation; real managers must be designated separately. No actual grant, authentication setting or production-policy activation accompanies this change.

The first implementation is an internal command with database integration evidence. A protected review screen, authenticated request composition, submission limits and real-identity E2E remain required before exposing management operations. Reuse the established Google identity boundary when connecting it, never accept operator IDs from request parameters. Rollback disconnects the capability and retains grants, revisions, receipts and audits; disable-only database rights must not be replaced with broad UPDATE grants.

## Verification

667 ordinary tests and 116 isolated PostgreSQL tests pass, including sixteen migrations applied twice, six concurrent same-key requests, competing keys, cross-shop and expired authority, rollback of the permission/receipt/SYSTEM audit on OPERATOR audit failure, re-enabled target replay rejection, actual lock-wait races, disable-only role privileges and immediate denial in the existing review query. Type/lint/static checks, production build and dependency audit pass. These are synthetic internal-command checks; no real manager is provisioned and no management endpoint or provider E2E is activated.
