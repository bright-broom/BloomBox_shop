# BloomBox database operations

PostgreSQL stores BloomBox-owned purchase intents, encrypted personal data, provider mappings, operational commerce projections, inbox and outbox records, idempotency state, reconciliation results, and audit history. Shopify remains authoritative for production commerce under ADR 0001.

## Required configuration

- `DATABASE_URL`: least-privilege application or migration connection, depending on the process.
- `DATABASE_WORKER_URL`: worker connection for inbox, outbox, reconciliation, and ledger work.
- `DATABASE_SSL_MODE`: `verify-full` in hosted environments; `disable` is allowed only for an isolated local database.
- `DATABASE_MAX_CONNECTIONS`: per-process connection limit from 1 to 20.
- `BLOOMBOX_PII_KEYRING`: JSON containing the active AES-256-GCM key ID and all retained decryption keys.
- `BLOOMBOX_RUNTIME_MODE`: defaults to `preview`; `production` selects the PostgreSQL purchase-intent adapter and fails closed if database or encryption configuration is missing.

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

## Local verification

Run a local PostgreSQL database named with `test`, set `TEST_DATABASE_URL`, then run `pnpm test:database`. The test drops only the guarded `bloombox` schema in that local test database, applies migrations twice, verifies encrypted persistence and atomic outbox creation, and checks the balanced-ledger constraint.
