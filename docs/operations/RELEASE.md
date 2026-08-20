# Release and Deployment

## Current status

Preview builds and a public product-preview deployment are supported. Production commerce activation is intentionally blocked because the composed application still uses preview catalog content and in-memory purchase-intent storage. Preview gift intents return in the current browser response and are not persisted. `pnpm check:production` is the executable source of truth for commerce blockers.

Do not disable or bypass that check. Complete ADR 0001's Shopify adapter, contract, security, and E2E work first.

## Environments

| Environment | Purpose | Data and integrations | Deployment |
| --- | --- | --- | --- |
| Local | Development and focused verification | Fixtures and test credentials only | `pnpm dev` |
| Preview | PR review, accessibility, responsive and stakeholder validation | Fixtures or isolated provider test store | Hosting-provider PR integration |
| Production | Real customer traffic and commerce | Approved production Shopify connection | Protected GitHub workflow |

Preview must be clearly distinguishable and must not send real notifications, charge money, or mutate production inventory.

## Automated release path

1. A focused PR selects L0-L3 risk and supplies review, verification, and rollback evidence.
2. CI validates repository policy, architecture boundaries, design tokens, hardcoding policy, content schemas, types, lint, tests, build, production dependencies, and deterministic Semgrep rules.
3. Required owners approve and merge to `main` after all required checks pass.
4. The release owner starts `Production Release` from the `main` branch, enters the full commit SHA that passed the gates, and explicitly confirms deployment.
5. The workflow checks out `main`, rejects any SHA mismatch, runs `pnpm check:release`, and stops before deployment if any production blocker remains.
6. The protected `production` environment requests human approval.
7. The workflow calls the configured deployment hook and polls `/api/health` until the healthy revision exactly matches the SHA that passed the release gates.

The hosting provider must keep immutable deployment history so the frontend can roll back without changing accepted Shopify orders.

`Production Smoke` runs after successful `main` CI, once per hour, and on demand. It verifies the release-shaped health response and the public home, catalog, product, and gift routes. A failure opens or refreshes one GitHub incident issue; a later successful run comments on and closes that issue automatically.

## Production exit criteria

- Shopify is authoritative for sellable catalog, price, availability, checkout, payment, orders, refunds, and inventory.
- The composition root contains approved durable checkout and Shopify adapters instead of both in-memory preview repositories.
- Provider input is runtime-validated; webhook signatures, API versions, timeouts, rate limits, idempotency, and retries are tested.
- Critical E2E tests pass against an isolated Shopify test store, including duplicate submission, changed price, unavailable inventory, checkout cancellation, and provider outage.
- Customer and recipient PII, gift metadata, logging, retention, deletion, and support access are documented and approved.
- Production secrets and environment protection are configured; no production secret reaches preview.
- Monitoring identifies failed checkout handoff, provider errors, latency, and invalid webhook rates without logging PII.
- The release owner has exercised frontend rollback and confirmed Shopify orders remain intact.

## Rollback and incidents

Rollback the experience layer to the last known-good immutable deployment. Do not rewrite, delete, or recreate accepted Shopify orders during frontend rollback. If the custom experience is unavailable, use the approved Shopify-hosted fallback when configured.

After rollback, verify the public origin, a read-only catalog request, and the Shopify admin order record. Reconciliation and customer support take priority over feature restoration when order state is uncertain.

## Required repository and platform setup

The repository automates code-verifiable conditions. The `production` Environment is restricted to `main`; the current GitHub plan does not support required reviewers or branch protection for this private repository, so governance issue #6 tracks the upgrade. The repository owner must also configure `PRODUCTION_DEPLOY_HOOK_URL`, `PRODUCTION_BASE_URL`, hosting rollback retention, and provider-side access controls. The hosting build must expose its Git revision through `BLOOMBOX_RELEASE_SHA`; Vercel's `VERCEL_GIT_COMMIT_SHA` is recognized automatically.
