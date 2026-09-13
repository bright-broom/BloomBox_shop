# Release and Deployment

## Current status

The selected target is native PostgreSQL commerce with direct Google customers ([ADR 0009](../architecture/adr/0009-native-commerce-and-google-customers.md)). The Google/customer-account slice replaces Shopify login. The production catalog reader uses PostgreSQL; real catalog data, native inventory, and live buyer/payment/fulfillment evidence remain incomplete. Customer-to-purchase binding is implemented, with real-provider verification still pending. New production checkout is paused in code. The release gate requires native-adapter evidence and remains blocked.

Preview builds and a public product-preview deployment are supported. The production composition now has a native PostgreSQL catalog reader, durable PurchaseIntent storage, a disabled Stripe connector, storefront search, order-status projection, and validated customer-information pages. Production commerce activation remains intentionally blocked until account-backed contract, E2E, tax, privacy, legal, support, recovery, and activation-decision evidence is recorded in `config/production-commerce-activation.json`. Preview では、ギフト設定からカート、配送先、注文確認、ダミー決済、完了までを Test Mode として再現します。Preview の Purchase Intent と個人情報は永続化しません。`pnpm check:production` is the executable source of truth for commerce blockers.

Do not disable or bypass that check. ADR 0009 supersedes the Shopify selection in ADR 0003. Existing Shopify adapters remain for legacy transactions during migration. The activation gate now requires `nativeCatalogContract`, alongside Stripe, inventory, tax/shipping, privacy/support, legal and recovery evidence. None of these entries is marked complete by the catalog migration. See [NATIVE_CATALOG.md](NATIVE_CATALOG.md).

## Environments

| Environment | Purpose | Data and integrations | Deployment |
| --- | --- | --- | --- |
| Local | Development and focused verification | Fixtures and test credentials only | `pnpm dev` |
| Preview | PR review, accessibility, responsive and stakeholder validation | Fixtures or isolated provider test store | Manual deployment of a reviewed PR commit |
| Production | Real customer traffic and commerce | Approved native database and payment-provider connections | Protected GitHub workflow |

Preview must be clearly distinguishable and must not send real notifications, charge money, or mutate production inventory.

## On-demand Vercel previews

Root `vercel.json` sets `git.deploymentEnabled` to `false`. Pushes and PR updates containing this configuration do not automatically deploy to Vercel, including pushes to `main`. GitHub CI, security scanning, dependency auditing, and PR governance continue to run as configured. Production continues to require the protected release path below; merging code is not authorization to deploy it.

Use the existing Vercel dashboard for manual previews; no additional CI credential or deployment workflow is required:

1. Finish the local checks and push the focused PR. Wait for the latest commit's quality/tests, dependency audit, security scan, and applicable governance checks to succeed. Do not interpret an absent Vercel check as proof of a successful deployment.
2. Record the PR's full head commit SHA. In the `bloom-box-shop` Vercel project, open **Deployments → Create Deployment** and enter that SHA. Select the PR branch configuration and **Preview**, never Production. Stop if the target environment or source cannot be confirmed. Review unfamiliar or forked code before exposing any preview credentials to its build.
3. Create one deployment. If the request times out, inspect Deployments for that SHA before retrying. If Vercel reports the daily quota, stop and wait for the allowance to recover; a manual deployment uses the same allowance. Do not create empty commits or repeatedly redeploy to clear a failed status.
4. Confirm the deployment is **Ready**, its environment is Preview, and its source SHA still matches the PR head. Check the affected flow on its preview URL. Record the SHA, URL, and result in the PR's verification evidence. If the PR changes, previous preview evidence no longer verifies the new head; deploy again when the next review is ready.

Rollout is branch-scoped: this setting takes effect only for commits containing `vercel.json`. Merge the configuration PR through normal review, then incorporate it into every existing branch before further development pushes. For a stack, merge the updated base in dependency order. Until a branch receives the file, its old automatic-deployment behavior remains. Existing deployments and historical failed statuses are not removed or marked successful by this change. A PR requiring visual or deployment verification remains pending until its manual preview succeeds.

Do not substitute an **Ignored Build Step**: canceled builds still consume deployment quota. Do not remove required checks or relax production activation to accommodate the manual preview policy. Before production activation, verify the protected release hook against this configuration; this change does not provide production deployment evidence.

To roll back the policy, revert the configuration commit in the affected branches. Subsequent pushes will resume automatic deployments and consume the normal allowance. Keep existing preview URLs and production deployment history intact.

Provider references: [Git deployment control](https://vercel.com/docs/project-configuration/git-configuration), [manual deployment from a Git SHA](https://vercel.com/docs/git#creating-a-deployment-from-a-git-reference), [ignored-build quota accounting](https://vercel.com/docs/project-configuration/project-settings), and [deployment limits](https://vercel.com/docs/limits).

## Automated release path

1. A focused PR selects L0-L3 risk and supplies review, verification, and rollback evidence.
2. CI validates repository policy, architecture boundaries, design tokens, hardcoding policy, content schemas, types, lint, tests, build, production dependencies, and deterministic Semgrep rules.
3. Required owners approve and merge to `main` after all required checks pass.
4. The release owner starts `Production Release` from the `main` branch, enters the full commit SHA that passed the gates, and explicitly confirms deployment.
5. The workflow checks out `main`, rejects any SHA mismatch, runs `pnpm check:release`, and stops before deployment if any production blocker remains.
6. The protected `production` environment requests human approval and applies checksummed forward-only database migrations with a dedicated owner credential.
7. The workflow calls the configured deployment hook and polls `/api/health` until the healthy revision exactly matches the SHA that passed the release gates.

The hosting provider must keep immutable deployment history so the frontend can roll back without changing accepted orders.

`Production Smoke` runs after successful `main` CI, once per hour, and on demand. It verifies the release-shaped health response and the public home, catalog, product, gift, cart, and Test Mode checkout routes. A failure opens or refreshes one GitHub incident issue; a later successful run comments on and closes that issue automatically.

## Production exit criteria

- BloomBox owns catalog, prices, inventory, buyers, orders and fulfillment in PostgreSQL; verified payment-provider facts remain authoritative for captures and refunds.
- The composition contains durable native catalog and checkout adapters. Real products, approved prices and assets are registered; preview fixtures never enter the production path.
- Native inventory reservation, release, consumption and reconciliation prevent overselling, double deductions and stuck reservations. Catalog availability alone is insufficient.
- Authenticated customer IDs bind to buyers at purchase creation, with ownership isolation and immutable price/destination snapshots.
- Provider input is runtime-validated; signatures, API versions, timeouts, rate limits, idempotency and retries are tested.
- Isolated Stripe test-mode E2E covers duplicate submission, changed prices, insufficient stock, checkout cancellation, provider outage, refunds and reconciliation. Complete the account-side requirements in [STRIPE.md](STRIPE.md) and the manual `Stripe Test Mode Readiness` workflow with separated credentials.
- Customer and recipient PII, gift metadata, logging, retention, deletion and support access are documented and approved.
- Legal disclosure, shipping, returns, terms, privacy, support hours and transactional notifications are approved and contain no Preview placeholders.
- Production secrets and environment protection are configured; no production secret reaches Preview.
- Monitoring identifies failed checkout handoff, provider errors, latency and invalid webhook rates without logging PII.
- Native fulfillment operations and recovery are verified. In-flight legacy transactions retain their originally assigned provider.
- All activation evidence is approved; the current code-level pause is replaced only as part of verified inventory/buyer integration, before commercial activation.
- The release owner has exercised frontend rollback, backup restore and incident response while preserving accepted orders.

## Rollback and incidents

Roll back the experience layer to the last known-good immutable deployment and pause new purchases. Do not rewrite, delete or recreate accepted orders, payment facts, customer identities or catalog records during frontend rollback. Do not automatically change a transaction's provider or redirect native purchases into Shopify.

After rollback, verify the public origin, a read-only catalog request, persisted orders and reconciliation for the assigned payment provider. Reconciliation and customer support take priority over feature restoration when order state is uncertain.

## Required repository and platform setup

The repository automates code-verifiable conditions. The `production` Environment has a deployment branch policy. The repository is now public, but the 2026-09-11 API check found no main protection/rulesets or required Production reviewer; governance issue #6 remains open until these controls are configured and verified. The repository owner must also configure `PRODUCTION_DEPLOY_HOOK_URL`, `PRODUCTION_BASE_URL`, `DATABASE_MIGRATION_URL`, hosting rollback retention, and provider-side access controls. The migration URL is a protected production secret and uses a dedicated owner credential; the runtime application never receives it. The hosting build must expose its Git revision through `BLOOMBOX_RELEASE_SHA`; Vercel's `VERCEL_GIT_COMMIT_SHA` is recognized automatically.

See [the remaining-work inventory](BACKLOG.md) for implementation gaps, pending account configuration, and release evidence, separated from optional product extensions.
