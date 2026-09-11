# ADR 0007: Audited operator permission revocation

Status: Proposed for production; scoped revocation command and authenticated management screen implemented, real configuration pending.

Date: 2026-09-12. Extends ADR 0005 and ADR 0006.

## Decision

Fulfillment owns a distinct, shop-scoped permission-manager grant and immutable revocation receipts. A verified request-bound identity port provides the actor; a browser-supplied actor or an ordinary approval permission cannot establish management authority. Manager grants are owner-provisioned and initially empty. This capability does not create manager grants, assign operators or enable approval permissions.

Revocation requires an explicit reason, exact reviewed permission version and idempotency key. It locks the active manager grant before the target permission, checks database time after lock waits, and atomically disables the target, writes the actor-attributed receipt and appends OPERATOR audit. Existing SYSTEM revision audit remains intact. Replays reauthorize the manager and cannot revoke a subsequently re-enabled version. No notification, dispatch or Outbox effect is required: the existing authorization queries observe the disabled permission directly.

A separate NOLOGIN database role has prerequisite reads/identity-column locks and append-only receipt/audit writes. A narrowly scoped SECURITY DEFINER SQL function can only disable an enabled target with the matching version; it cannot enable, create or reassign a permission. Its search path is fixed, all application objects are schema-qualified and PUBLIC execution is revoked. General application, worker and fulfillment-approver roles gain no management rights. The database credential is a trusted infrastructure boundary, not a substitute for application-level manager authorization.

## Consequences and rollout

Migration 0016 adds manager grants, immutable receipts and the restricted disable function. Apply it and reapply dedicated role grants before composing the capability. Manager provisioning remains a privileged, SYSTEM-audited bootstrap operation; real managers must be designated separately. No actual grant, authentication setting or production-policy activation accompanies this change.

Owner provisioning is now supported by an offline plan/apply CLI owned by Fulfillment infrastructure. It requires a separate admin connection, checks schema/table ownership and database name, binds a confirmation digest to the exact request/current version, and atomically writes the permission revision and SYSTEM operation audit. Migration 0018 restricts provisioning-audit inserts to schema owners and makes these receipts immutable, so ordinary runtime audit writers cannot forge replay evidence. The CLI refuses to run without this enabled guard. Existing runtime roles gain no privileges. The change UUID links to a private human execution record; it is not a verified Google actor. This implements the existing owner-only bootstrap/maintenance boundary without exposing a grant endpoint. See [operator access provisioning](../../operations/OPERATOR_ACCESS_PROVISIONING.md) for retries, audit and recovery.

The initial internal command is now connected to a protected review screen and Server Action through the established Google identity boundary. A separate DATABASE_PERMISSION_MANAGER_URL is mandatory; no fallback to approval/application credentials is allowed. Real manager designation, Google configuration and real-identity E2E remain activation prerequisites. Rollback disconnects the capability and retains grants, revisions, receipts and audits; disable-only database rights must not be replaced with broad UPDATE grants.

## Verification

667 ordinary tests and 116 isolated PostgreSQL tests pass, including sixteen migrations applied twice, six concurrent same-key requests, competing keys, cross-shop and expired authority, rollback of the permission/receipt/SYSTEM audit on OPERATOR audit failure, re-enabled target replay rejection, actual lock-wait races, disable-only role privileges and immediate denial in the existing review query. Type/lint/static checks, production build and dependency audit pass. These are synthetic internal-command checks; no real manager is provisioned and no management endpoint or provider E2E is activated.

## Authenticated management screen

`/operations/permissions` reauthorizes the scoped manager on each bounded query, locks the grant and checks database time after reads. Its default is the first currently authorized shop; explicit shop changes still require that scope. Cursor positions grant no authority. Migration 0017 adds lookup indexes. The DTO contains only operator registration UUIDs, permission state/expiry/version and latest actor/reason/time history, without Google subjects, emails, customer data or tokens.

Enabled targets receive a purpose-separated encrypted review intent, bound to the exact shop/permission/version, current actor/session expiry, runtime mode and a server-generated idempotency key. It lasts at most five minutes. The Server Action requires canonical Origin, validated fields, a fixed reason and acknowledgement, then consumes the existing shared ten-per-minute operator allowance before decoding context and invoking the transactional revoker. Approval and revocation share that allowance intentionally; the legacy table name is retained. Revocation is independent of merchant sales approval, so pending commerce policy cannot prevent authorized access removal.

Failure keeps the same context and selected reason for retry; reason changes require renewed acknowledgement. The native form reset is cancelled because it otherwise clears selection after an Action failure. A committed revocation remains successful if view revalidation fails. The new permission-manager DB role receives only the existing allowance-table rights, not approval or commerce writes. All management responses retain private/no-store, no-referrer and noindex controls. Real grants remain unconfigured.
