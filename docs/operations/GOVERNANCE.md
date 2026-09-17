# Engineering Governance

This policy turns architecture, design, security, and release expectations into owned decisions and enforceable checks.

## Accountability

| Decision area | Accountable role | Required evidence |
| --- | --- | --- |
| Product scope and customer promise | Product owner | Acceptance criteria and measured outcome |
| Module boundary, provider, system of record | Principal architect | Accepted ADR and rollback plan |
| Interaction, content hierarchy, accessibility | Principal designer | State coverage and visual evidence |
| Implementation, reliability, tests | Principal software engineer | Passing gates and failure analysis |
| Production release | Release owner | Release checklist, environment approval, smoke test |
| Security or privacy boundary | Security reviewer or designated owner | Threat review, data-flow and retention impact |

One person may hold multiple roles while the team is small, but the PR records which perspective was applied. Approval is not delegated to automation: automation proves deterministic conditions, while a named owner accepts product and operational judgment.

## Change levels and review

- L0 — documentation, copy, or metadata: one code-owner review; rendered meaning and repository policy.
- L1 — presentation or design without business rules: L0 plus design/accessibility review, mobile evidence, typecheck, lint, and relevant build.
- L2 — application, domain, provider adapter, dependency, or architecture boundary: L1 plus architecture review, focused tests, dependency impact, and rollback.
- L3 — payment, authentication, PII, webhook, schema, inventory, fulfillment, or production infrastructure: L2 plus security review, failure/idempotency evidence, migration rehearsal where applicable, and critical-flow E2E evidence.

The highest affected level applies. A PR selects exactly one level in the template, and PR Governance verifies that the evidence headings exist.

## Repository controls

Configure the GitHub `main` branch ruleset with:

- pull requests required; direct pushes and force pushes blocked;
- conversation resolution required;
- required code-owner review;
- required checks: `Quality, architecture, and tests`, `Production dependency audit`, `JavaScript and TypeScript security scan`, and `Validate risk and review evidence`;
- branch required to be current before merge;
- no administrator bypass except documented incident recovery.

Repository files cannot enforce account-level rulesets. The repository owner must configure them in GitHub and review the settings quarterly. Changes to required checks are made in the same PR as their workflow changes so names do not drift silently.

## Secrets and environments

- Use separate preview and production credentials with least privilege.
- Protect the GitHub `production` environment with a required reviewer.
- Restrict the `production` environment's allowed deployment branch to `main`.
- Store the deploy hook only as `PRODUCTION_DEPLOY_HOOK_URL` in the protected environment.
- Store the public smoke-test origin as the `PRODUCTION_BASE_URL` environment variable.
- Configure the hosting platform to expose the deployed Git revision as `BLOOMBOX_RELEASE_SHA`; Vercel's `VERCEL_GIT_COMMIT_SHA` is supported automatically.
- Rotate credentials after exposure, role changes, or provider-defined limits; never copy production secrets into local files or PR logs.
- Document every production secret's owner, purpose, scope, rotation method, and revocation path in the team's private credential inventory.

## Operational cadence

- Dependabot proposes package and GitHub Actions updates; CI and a human review remain required.
- Semgrep uses the checked-in deterministic rule set. Rule changes are reviewed like code.
- The release owner reviews failed production releases and records follow-up work when rollback or manual intervention occurs.
- Production Smoke checks the public experience after successful `main` CI and hourly; it owns a deduplicated GitHub incident issue until recovery.
- Quarterly: review code ownership, branch rules, access, secrets, dependency health, provider API versions, backup/restore evidence, and ADR accuracy.
- After an incident: write a blameless record with timeline, customer impact, contributing conditions, detection gap, remediation owner, and due date.

## Exceptions

An exception states the exact control, reason, owner, expiry date, compensating control, and removal issue. Permanent verbal exceptions are invalid. Urgent production recovery may use the narrowest available bypass, followed by a PR and incident record.

### 2026-09-17: owner and enforced controls

The user designated GitHub user `bright-broom` as both release owner and code reviewer. The account identity (user ID 170618233), repository admin access, and applied API settings were verified on 2026-09-17.

- `main`: PR workflow, all four required checks above, up-to-date branch, resolved conversations, administrator enforcement, and no force pushes/deletions are configured.
- GitHub `Production`: required reviewer `bright-broom`; only `main` is allowed. Self-review of environment deployments is permitted so the sole release owner can approve a release they initiated.
- `PRODUCTION_BASE_URL`: corrected to `https://bloom-box-shop-ybb9.vercel.app`. Health identified release `259356edf51def7030729822df32e07ff82a3b54`; the URL setting alone does not deploy later commits.

**Remaining control / issue #6:** GitHub does not let a PR author approve their own PR. `CODEOWNERS` names `@bright-broom`, but required approving reviews is currently zero and required code-owner review is off. This is a temporary single-owner limitation, not completion of independent review. The owner must nominate another reviewer or explicitly adopt a revised long-term governance policy by 2026-09-30. Until then, focused PRs, all required checks, documented risk/rollback, and an explicit owner release approval are the compensating controls. The automation must not claim it provided a human approval.

Reference: [GitHub required-review behavior](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews).

The GitHub environment approval protects jobs that use that environment. It does not independently prevent deployments from the Vercel console, CLI, or unrelated integrations. Hosting permissions and private secret inventory still require separate verification; no production release was initiated as part of this settings update.
