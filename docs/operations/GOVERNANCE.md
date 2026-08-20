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
- Quarterly: review code ownership, branch rules, access, secrets, dependency health, provider API versions, backup/restore evidence, and ADR accuracy.
- After an incident: write a blameless record with timeline, customer impact, contributing conditions, detection gap, remediation owner, and due date.

## Exceptions

An exception states the exact control, reason, owner, expiry date, compensating control, and removal issue. Permanent verbal exceptions are invalid. Urgent production recovery may use the narrowest available bypass, followed by a PR and incident record.
