# Release and Deployment

## Confirmed public target (2026-09-17)

The public preview origin is **https://bloom-box-shop-ybb9.vercel.app**, Vercel project `bloom-box-shop-ybb9` (`prj_uguMJ5XHO9Vx6qvij8mELEKAtHyp`). The repository variable `PRODUCTION_BASE_URL` was re-read and matches this origin. `/api/health` returned `259356edf51def7030729822df32e07ff82a3b54`; this is separate from the documentation baseline `7472c5f` on main. Recheck both before any deployment. A local `.vercel/project.json` pointing at old `bloom-box-shop` is not the public target.

Vercel's environment label `production` currently hosts the application's **preview runtime with sales paused**. That label, successful CI, merged code, and a healthy preview do not mean commercial activation. The dedicated public DB was recorded through migration 0027 during [customer self-service deployment](CUSTOMER_SELF_SERVICE_RELEASE_2026-09-17.md); this is not evidence of every future sales credential, backup or payment connection.

## Current status

The selected target is native PostgreSQL commerce with direct Google customers ([ADR 0009](../architecture/adr/0009-native-commerce-and-google-customers.md)). The Google/customer-account slice replaces Shopify login. The production catalog reader uses PostgreSQL; real catalog/stock setup and live buyer/payment/fulfillment evidence remain incomplete. Native stock reservation, commitment and safe release are implemented; see [NATIVE_INVENTORY.md](NATIVE_INVENTORY.md). Customer-to-purchase binding is implemented, with real-provider verification still pending. New production checkout is paused in code. The release gate requires native-adapter evidence and remains blocked.

Preview builds and a public product-preview deployment are supported. The production composition now has a native PostgreSQL catalog reader, durable PurchaseIntent storage, a disabled Stripe connector, storefront search, order-status projection, and validated customer-information pages. Production commerce activation remains intentionally blocked until account-backed contract, E2E, tax, privacy, legal, support, recovery, and activation-decision evidence is recorded in `config/production-commerce-activation.json`. Preview では、ギフト設定からカート、配送先、注文確認、ダミー決済、完了までを Test Mode として再現します。Preview の Purchase Intent と個人情報は永続化しません。`pnpm check:production` is the executable source of truth for commerce blockers.

Do not disable or bypass that check. ADR 0009 supersedes the Shopify selection in ADR 0003. Existing Shopify adapters remain for legacy transactions during migration. The activation gate now requires `nativeCatalogContract`, alongside Stripe, inventory, tax/shipping, privacy/support, legal and recovery evidence. None of these entries is marked complete by the catalog migration. See [NATIVE_CATALOG.md](NATIVE_CATALOG.md).

## Environments

| Environment | Purpose | Data and integrations | Deployment |
| --- | --- | --- | --- |
| Local | Development and focused verification | Fixtures and test credentials only | `pnpm dev` |
| Preview | PR review, accessibility, responsive and stakeholder validation | Fixtures or isolated provider test store | Manual deployment of a reviewed PR commit |
| Production | Real customer traffic and commerce | Approved native database and payment-provider connections | Protected GitHub workflow |

Preview must be clearly distinguishable and must not send real notifications, charge money, or mutate production inventory.

## Automatic main deployment

2026-09-26 ([ADR 0022](../architecture/adr/0022-automatic-main-deployment.md)). The `Auto Deploy` workflow runs after CI succeeds on a push to `main`: it applies pending migrations in expand-only mode, calls the deploy hook, and waits until `/api/health` reports the exact revision CI verified. Vercel's Git deployments stay disabled, so each main revision deploys once and PRs never deploy. It does not open commerce; ADR 0020 still gates new purchases in code.

Enable it once, in this order:

1. In the `production` GitHub Environment, confirm `PRODUCTION_DEPLOY_HOOK_URL` (a Vercel Deploy Hook for the `main` branch of project `bloom-box-shop-ybb9`) and `DATABASE_MIGRATION_URL` (the owner connection for the public database). Confirm the repository variable `PRODUCTION_BASE_URL` is `https://bloom-box-shop-ybb9.vercel.app`.
2. Check the public database's history with `pnpm db:status` and a history reader ([DATABASE_PREFLIGHT.md](DATABASE_PREFLIGHT.md)). The first automatic run applies everything pending (expected: 0028–0030, all expand-only).
3. Set the repository variable `AUTO_DEPLOY_ENABLED=true`. The next merge to `main` deploys; to deploy the current `main` immediately, re-run its latest successful `CI` run.
4. After the first run, confirm `/api/health` shows the new revision and that `Production Smoke` passes.

When it stops:

- **Expand-only refusal** (`ContractingMigrationError`): nothing was applied. Split the change into an additive step that deploys automatically and a later contracting step released through `Production Release` after old code is gone.
- **Configuration missing**: set the named secret or variable; re-run the failed job.
- **Health did not report the revision**: inspect the Vercel deployment for that SHA. If the build failed, fix forward on `main`; if the site is unhealthy, promote the previous deployment in Vercel. Applied migrations stay (forward-only and additive).

Disable it by setting `AUTO_DEPLOY_ENABLED` to anything but `true`.

## On-demand Vercel previews

Root `vercel.json` sets `git.deploymentEnabled` to `false`. Pushes and PR updates containing this configuration do not automatically deploy to Vercel, including pushes to `main`. GitHub CI, security scanning, dependency auditing, and PR governance continue to run as configured. Production continues to require the protected release path below; merging code is not authorization to deploy it.

Use the existing Vercel dashboard for manual previews; no additional CI credential or deployment workflow is required:

1. Finish the local checks and push the focused PR. Wait for the latest commit's quality/tests, dependency audit, security scan, and applicable governance checks to succeed. Do not interpret an absent Vercel check as proof of a successful deployment.
2. Record the PR's full head commit SHA. In the verified `bloom-box-shop-ybb9` Vercel project, open **Deployments → Create Deployment** and enter that SHA. Select the PR branch configuration and **Preview**, never Production. Stop if the target environment or source cannot be confirmed. Review unfamiliar or forked code before exposing any preview credentials to its build.
3. Create one deployment. If the request times out, inspect Deployments for that SHA before retrying. If Vercel reports the daily quota, stop and wait for the allowance to recover; a manual deployment uses the same allowance. Do not create empty commits or repeatedly redeploy to clear a failed status.
4. Confirm the deployment is **Ready**, its environment is Preview, and its source SHA still matches the PR head. Check the affected flow on its preview URL. Record the SHA, URL, and result in the PR's verification evidence. If the PR changes, previous preview evidence no longer verifies the new head; deploy again when the next review is ready.

Rollout is branch-scoped: this setting takes effect only for commits containing `vercel.json`. Merge the configuration PR through normal review, then incorporate it into every existing branch before further development pushes. For a stack, merge the updated base in dependency order. Until a branch receives the file, its old automatic-deployment behavior remains. Existing deployments and historical failed statuses are not removed or marked successful by this change. A PR requiring visual or deployment verification remains pending until its manual preview succeeds.

Do not substitute an **Ignored Build Step**: canceled builds still consume deployment quota. Do not remove required checks or relax production activation to accommodate the manual preview policy. Before production activation, verify the protected release hook against this configuration; this change does not provide production deployment evidence.

To roll back the policy, revert the configuration commit in the affected branches. Subsequent pushes will resume automatic deployments and consume the normal allowance. Keep existing preview URLs and production deployment history intact.

Provider references: [Git deployment control](https://vercel.com/docs/project-configuration/git-configuration), [manual deployment from a Git SHA](https://vercel.com/docs/git#creating-a-deployment-from-a-git-reference), [ignored-build quota accounting](https://vercel.com/docs/project-configuration/project-settings), and [deployment limits](https://vercel.com/docs/limits).

## Read-only database preflight

Before an approved deployment, run `pnpm db:status` at the candidate SHA using a dedicated `DATABASE_STATUS_URL`. It compares migration history without applying SQL or initializing the database. Pending, mismatched, or unreadable history exits nonzero. This does not replace schema/role review or the protected migration step. See [configuration, evidence, and limits](DATABASE_PREFLIGHT.md).

## Automated release path

1. A focused PR selects L0-L3 risk and supplies review, verification, and rollback evidence.
2. CI validates repository policy, architecture boundaries, design tokens, hardcoding policy, content schemas, types, lint, tests, build, production dependencies, and deterministic Semgrep rules.
3. Required owners approve and merge to `main` after all required checks pass.
4. The release owner starts `Production Release` from the `main` branch, enters the full commit SHA that passed the gates, and explicitly confirms deployment.
5. The workflow checks out `main`, rejects any SHA mismatch, runs `pnpm check:release`, and stops before deployment if any production blocker remains.
6. The workflow targets the `production` GitHub environment. Before commercial deployment, the release owner must verify its actual protection and required reviewer settings under #6; an environment name alone does not enforce approval. Once configured and approved, the job applies checksummed forward-only database migrations with a dedicated owner credential.
7. The workflow calls the configured deployment hook and polls `/api/health` until the healthy revision exactly matches the SHA that passed the release gates.

The hosting provider must keep immutable deployment history so the frontend can roll back without changing accepted orders.

`Production Smoke` runs after successful `main` CI, once per hour, and on demand. It checks out trusted monitor code from main and runs the read-only `scripts/verify-public-preview.mjs` against the configured HTTPS origin. It verifies the deployed release-shaped health response, HTTP 200 and page structure, required preview/card-safety disclosures, security headers, rendered M-only search results and an accessible empty search. It ignores references inside hydration scripts and does not depend on the editorial label “検索結果”. Receipt completion has a specific loading-state SSR contract because no browser purchase session exists in this probe.

The workflow checks one of two approved contracts, chosen by the deployment itself: `/api/health` reports `commerce` as `paused` or `open` from the same rule that gates intake (ADR 0020). While paused it requires the non-selling disclosures and the dummy-checkout rehearsal pages. While open it requires the opposite — no preview or rehearsal wording, the complete 特定商取引法 disclosure, the purchase terms on the cart, and HTTP 404 on every rehearsal route. Never satisfy either contract by deleting a disclosure from the site; change the contract only through a reviewed monitor update. It does not log in, submit forms, create orders, send ads, or prove customer/Stripe/worker E2E. Its logged deployed SHA is not required to equal the latest main SHA because deployment is manual; the release workflow separately requires an exact revision match. A failure opens or refreshes one incident, and a later full success closes it. Existing incident bodies remain unchanged: the latest failure run is recorded in one dedicated bot comment, leaving operator evidence intact. See [incident evidence retention](INCIDENT_EVIDENCE_RETENTION.md). [Current evidence and limitations](PUBLIC_PREVIEW_VERIFICATION_2026-09-17.md).

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
- All activation evidence is approved. Since ADR 0020 (2026-09-19) the runtime gate opens production intake only when `BLOOMBOX_CHECKOUT_INTAKE_ENABLED=true`, the bundled activation record passes the same evidence rules as `pnpm check:production`, and the storefront content is `approved`; no code change is needed at activation, and a test keeps the release script and runtime rule in agreement.
- The release owner has exercised frontend rollback, backup restore and incident response while preserving accepted orders.

## Commercial activation sequence (ADR 0020)

1. Record each evidence item in `config/production-commerce-activation.json` with `complete: true` and a reference to its evidence, set `status` to `approved`, and approve the storefront content, all in reviewed PRs. `pnpm check:release` must pass on the merged SHA.
2. Deploy that SHA through `Production Release`. Intake stays closed until the switch is on.
3. Set `BLOOMBOX_CHECKOUT_INTAKE_ENABLED=true` in the production environment and redeploy the same SHA. The smoke monitor switches to the selling contract on its own once `/api/health` reports `commerce: "open"`; run `Production Smoke` right after the switch and expect it to check the selling contract.
4. To pause new purchases immediately, set `BLOOMBOX_CHECKOUT_INTAKE_ENABLED=false`. Payments, webhooks, reconciliation, refunds and fulfillment of accepted orders continue.

## Rollback and incidents

Roll back the experience layer to the last known-good immutable deployment and pause new purchases. Do not rewrite, delete or recreate accepted orders, payment facts, customer identities or catalog records during frontend rollback. Do not automatically change a transaction's provider or redirect native purchases into Shopify.

After rollback, verify the public origin, a read-only catalog request, persisted orders and reconciliation for the assigned payment provider. Reconciliation and customer support take priority over feature restoration when order state is uncertain.

## Required repository and platform setup

The repository automates code-verifiable conditions. Required main checks, reviewer enforcement, and the actual release environment protection are tracked in [Issue #6](https://github.com/bright-broom/BloomBox_shop/issues/6); read its current evidence rather than treating an old unprotected/protected snapshot as present fact. The repository owner must verify `PRODUCTION_DEPLOY_HOOK_URL`, `DATABASE_MIGRATION_URL`, hosting rollback retention, and provider-side access controls. `PRODUCTION_BASE_URL` was confirmed above; a repository variable does not prove the hook or all environment overrides match it. The migration URL is a protected production secret and uses a dedicated owner credential; the runtime application never receives it. The hosting build must expose its Git revision through `BLOOMBOX_RELEASE_SHA`; Vercel's `VERCEL_GIT_COMMIT_SHA` is recognized automatically.

See [the remaining-work inventory](BACKLOG.md) for implementation gaps, pending account configuration, and release evidence, separated from optional product extensions.
