# Release and Deployment

## Current status

Preview builds and a public product-preview deployment are supported. The production composition now has a Shopify Storefront catalog adapter, durable PurchaseIntent storage, a disabled Stripe connector, storefront search, order-status projection, and validated customer-information pages. Production commerce activation remains intentionally blocked until account-backed contract, E2E, tax, privacy, legal, support, recovery, and activation-decision evidence is recorded in `config/production-commerce-activation.json`. Preview では、ギフト設定からカート、配送先、注文確認、ダミー決済、完了までを Test Mode として再現します。Preview の Purchase Intent と個人情報は永続化しません。`pnpm check:production` is the executable source of truth for commerce blockers.

Do not disable or bypass that check. ADR 0003 selects Shopify Checkout + Shopify Payments + KOMOJU for implementation. The new Shopify cart client is disconnected from the purchase flow; complete the integration and per-method evidence in [PAYMENTS.md](PAYMENTS.md) before activation. The current executable activation gate and activation JSON still describe the older Stripe candidate and remain blocked; replacing those requirements with the completed Shopify flow is required work, not a reason to mark Stripe evidence complete.

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
6. The protected `production` environment requests human approval and applies checksummed forward-only database migrations with a dedicated owner credential.
7. The workflow calls the configured deployment hook and polls `/api/health` until the healthy revision exactly matches the SHA that passed the release gates.

The hosting provider must keep immutable deployment history so the frontend can roll back without changing accepted Shopify orders.

`Production Smoke` runs after successful `main` CI, once per hour, and on demand. It verifies the release-shaped health response and the public home, catalog, product, gift, cart, and Test Mode checkout routes. A failure opens or refreshes one GitHub incident issue; a later successful run comments on and closes that issue automatically.

## Production exit criteria

- Shopify is authoritative for sellable catalog, price, availability, checkout, payment, orders, refunds, and inventory.
- The composition root contains approved durable checkout and Shopify adapters instead of both in-memory preview repositories.
- Provider input is runtime-validated; webhook signatures, API versions, timeouts, rate limits, idempotency, and retries are tested.
- Critical E2E tests pass against an isolated Shopify test store, including duplicate submission, changed price, unavailable inventory, checkout cancellation, and provider outage.
- Customer and recipient PII, gift metadata, logging, retention, deletion, and support access are documented and approved.
- Legal disclosure, shipping, returns, terms, privacy, support hours, and transactional notifications are approved and contain no Preview placeholders.
- Production secrets and environment protection are configured; no production secret reaches preview.
- Monitoring identifies failed checkout handoff, provider errors, latency, and invalid webhook rates without logging PII.
- If Stripe is activated, the test-mode evidence and account-side checklist in `STRIPE.md` are complete, Event reconciliation is healthy, and the live credentials are isolated from Preview.
- For a separately approved direct Stripe activation only, the Stripe account contract must pass the manual `Stripe Test Mode Readiness` workflow with separate Checkout, reconciliation, and readiness credentials. That workflow does not establish readiness for the selected Shopify + KOMOJU path.
- If Stripe is activated while Shopify remains inventory authority, the approved activation ADR and test evidence cover reservation, release, oversell prevention, and reconciliation before any charge is accepted.
- The release owner has exercised frontend rollback and confirmed Shopify orders remain intact.

## Rollback and incidents

Rollback the experience layer to the last known-good immutable deployment. Do not rewrite, delete, or recreate accepted Shopify orders during frontend rollback. If the custom experience is unavailable, use the approved Shopify-hosted fallback when configured.

After rollback, verify the public origin, a read-only catalog request, and the Shopify admin order record. Reconciliation and customer support take priority over feature restoration when order state is uncertain.

## Required repository and platform setup

The repository automates code-verifiable conditions. The `production` Environment has a deployment branch policy. The repository is now public, but the 2026-09-11 API check found no main protection/rulesets or required Production reviewer; governance issue #6 remains open until these controls are configured and verified. The repository owner must also configure `PRODUCTION_DEPLOY_HOOK_URL`, `PRODUCTION_BASE_URL`, `DATABASE_MIGRATION_URL`, hosting rollback retention, and provider-side access controls. The migration URL is a protected production secret and uses a dedicated owner credential; the runtime application never receives it. The hosting build must expose its Git revision through `BLOOMBOX_RELEASE_SHA`; Vercel's `VERCEL_GIT_COMMIT_SHA` is recognized automatically.

See [the remaining-work inventory](BACKLOG.md) for implementation gaps, pending account configuration, and release evidence, separated from optional product extensions.
