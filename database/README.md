# BloomBox database operations

PostgreSQL stores BloomBox-owned catalog products, customer identities, purchase intents, encrypted personal data, provider mappings, orders, inbox and outbox records, idempotency state, reconciliation results, and audit history. ADR 0009 selects native commerce; legacy Shopify records remain during migration and production activation is blocked.

## Required configuration

- `DATABASE_URL`: least-privilege application or migration connection, depending on the process.
- `DATABASE_WORKER_URL`: worker connection for inbox, outbox, reconciliation, and ledger work.
- `DATABASE_SSL_MODE`: `verify-full` in hosted environments; `disable` is allowed only for an isolated local database.
- `DATABASE_MAX_CONNECTIONS`: per-process connection limit from 1 to 20.
- `BLOOMBOX_PII_KEYRING`: JSON containing the active AES-256-GCM key ID and all retained decryption keys.
- `BLOOMBOX_RUNTIME_MODE`: defaults to `preview`; `production` selects the PostgreSQL catalog and purchase-intent adapters and fails closed if database or encryption configuration is missing.
- Stripe connector configuration and account-side setup are documented in `docs/operations/STRIPE.md`.
- Native catalog setup and migration boundaries are documented in [NATIVE_CATALOG.md](../docs/operations/NATIVE_CATALOG.md). Shopify configuration is needed only for retained legacy integrations.

Example names only; use secret management rather than a checked-in environment file:

```text
BLOOMBOX_RUNTIME_MODE=preview
DATABASE_URL=postgres://bloombox_application:<password>@<host>:5432/bloombox
DATABASE_WORKER_URL=postgres://bloombox_worker:<password>@<host>:5432/bloombox
DATABASE_MIGRATION_URL=postgres://bloombox_migration:<password>@<host>:5432/bloombox
DATABASE_SSL_MODE=verify-full
DATABASE_MAX_CONNECTIONS=5
BLOOMBOX_PII_KEYRING={"activeKeyId":"<key-id>","keys":{"<key-id>":"<base64-32-byte-key>"}}
```

Never use a production URL in automated tests. The integration suite refuses non-local URLs and database names without `test`.

## Provisioning

1. Create a managed PostgreSQL database with high availability, point-in-time recovery, encrypted storage, private networking where available, and a connection pool compatible with prepared statements.
2. Run migrations with a dedicated owner credential: `pnpm db:migrate`.
3. If the provider permits role administration, apply `database/roles.sql` as an administrator after every migration set and grant login roles to the documented group roles. Otherwise reproduce the same grants through the provider console. New tables receive no automatic write grants.
4. Configure application and worker URLs independently with least privilege.
5. Exercise a restore into an isolated database before production activation and quarterly thereafter.

Migration files are immutable after application. The runner records a SHA-256 checksum and refuses a changed historical migration. Schema corrections use a new forward migration; production rollback never edits or deletes accepted commerce facts.

The protected commerce worker claims encrypted Inbox rows with row-level locking and bounded exponential retry, then runs transient-data retention. Shopify checkout credentials are encrypted in the Checkout-owned `shopify_checkout_attempts` table (migration 0005); the legacy plaintext external ID stays NULL for Shopify. Provider selection is permanent, and unresolved Shopify attempts are held for reconciliation. See [durable Shopify handoff](../docs/operations/SHOPIFY_CHECKOUT_ATTEMPTS.md) before migration, retention changes, or rollback.

It expires unstarted non-Shopify PurchaseIntents after 24 hours and removes encrypted Webhook payloads and personal data from terminal PurchaseIntents after 30 days while retaining provider identifiers, processing status, audits, and confirmed Order snapshots needed for reconciliation and support. Changes to confirmed-order retention require a separate privacy and legal review.

## Local verification

Run a local PostgreSQL database named with `test`, set `TEST_DATABASE_URL`, then run `pnpm test:database`. The test drops only the guarded `bloombox` schema in that local test database, applies migrations twice, verifies encrypted persistence and atomic outbox creation, and checks the balanced-ledger constraint.

Migration 0006 adds Checkout-owned immutable Shopify order links and a scoped cart-token digest index. Apply `database/roles.sql` afterward. Legacy READY attempts remain unindexed until verified resume; do not backfill by guessing tokens or by plaintext export. See [association and rollback](../docs/operations/SHOPIFY_ORDER_LINKS.md).

Migration 0007 stores Payment-owned Shopify settlement evidence with an exact foreign key to the immutable checkout association. Reapply `database/roles.sql` for worker access. It does not create accepted orders or trigger fulfillment. See [settlement evidence and recovery](../docs/operations/SHOPIFY_PAYMENT_EVIDENCE.md).

Migration 0014 adds Fulfillment-owned shop-scoped operator permissions and immutable approval receipts. Reapply `database/roles.sql`; the new NOLOGIN `bloombox_fulfillment_approver` role is separate from application/worker access and grants only prerequisite reads/locks and approval/audit/Outbox inserts. Do not grant it to existing worker or public application credentials. Permission administration is owner-only and audited. The authenticated operator form is connected but merchant policy remains PENDING; it never dispatches. See [approval, verification and rollback](../docs/operations/SHOPIFY_FULFILLMENT_APPROVAL.md).

Migration 0015 adds a bounded, Fulfillment-owned rolling submission allowance per mapped operator. Reapply `database/roles.sql` before deploying the limiter: only the dedicated operator role gains SELECT/INSERT and timestamp updates, without key reassignment or DELETE. New code fails closed without the table or grants. Switch all approval traffic off old code before activation; rollback must disable approvals while retaining the additive table and migration. See [submission limit operations](../docs/operations/OPERATOR_APPROVAL_RATE_LIMIT.md).

Migration 0016 adds scoped permission-manager grants, immutable revocation receipts and a restricted disable-only function. Apply `database/roles.sql` for the separate NOLOGIN `bloombox_permission_manager` role; do not attach it to application/worker/approver credentials. The function has fixed search_path and no PUBLIC execution. Manager grants start empty. The internal command requires a verified actor and scoped manager authorization; authenticated management composition now requires a separate DATABASE_PERMISSION_MANAGER_URL and explicit scoped manager grant. See [revocation operations and rollback](../docs/operations/OPERATOR_PERMISSION_REVOCATION.md).

Migration 0017 adds scoped permission-list and latest-revocation lookup indexes. Reapply `database/roles.sql` so the dedicated manager role shares the existing submission allowance with approval operations. Configure `DATABASE_PERMISSION_MANAGER_URL` against the same database with a separate least-privilege login; there is no fallback to application/worker/approver URLs. See [management screen rollout](../docs/operations/OPERATOR_PERMISSION_MANAGEMENT.md).

Migration 0018 restricts operator provisioning audit receipts to schema-owner inserts and protects them from update/delete. It preserves unrelated audit operations and adds no role grants. Apply it before using the offline owner-only plan/apply tool with `DATABASE_OPERATOR_ADMIN_URL`; never expose this credential to runtime roles or previews. The tool refuses missing/disabled protection, uses reviewed versions and confirmation digests, and atomically records before/after SYSTEM audit. Retain this migration and receipts on rollback. See [operator and manager provisioning](../docs/operations/OPERATOR_ACCESS_PROVISIONING.md).

Migration 0019 adds the Catalog-owned `catalog_products` table, initially empty with DRAFT/unavailable defaults. Reapply `database/roles.sql` for application/worker SELECT-only access. Existing commerce tables, identifiers and prices are not migrated or overwritten. Native inventory reservations and operator catalog editing remain incomplete; new production checkout stays paused in code. Retain catalog data and migration history on rollback. See [native catalog operations](../docs/operations/NATIVE_CATALOG.md).

Migration 0020 adds immutable Checkout-owned customer ID/version snapshots to purchase intents. Customer creates buyer links from those snapshots inside the existing acceptance transaction. Intent owner, buyer customer, and order buyer references cannot be reassigned, including NULL-to-customer claims of historical purchases. Existing rows remain anonymous. Reapply roles.sql for worker SELECT on buyer ID/customer ID only, used by the order ownership constraint. Old workers that drop a stored customer link fail closed. Physical deletion of linked principals is restricted; use the reviewed anonymization/retention workflow rather than unlinking orders. Keep the migration and a binding-aware payment worker on rollback. See [purchase customer binding](../docs/operations/PURCHASE_CUSTOMER_BINDING.md).
