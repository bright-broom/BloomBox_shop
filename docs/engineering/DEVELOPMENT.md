# BloomBox Development

Use the relevant section for the current change; do not load this entire guide when a narrower lookup is enough.

## TypeScript and boundaries

- Keep strict TypeScript enabled.
- Avoid `any`, `@ts-ignore`, and `as unknown as`. Explain a necessary exception next to the boundary.
- Types do not validate runtime data. Validate forms, APIs, webhooks, environment variables, provider responses, and AI output with Zod or the repository standard.
- Use business names. Avoid generic dumping grounds such as `utils.ts`, `helpers.ts`, or `service.ts`.
- Prefer object parameters when multiple booleans would obscure intent.
- Expected business failures use typed errors. Never catch and ignore an error.
- Queries are read-only. Names must not hide writes or external effects.
- Comments explain constraints and reasons, not what the code visibly does.
- Cross-module imports use `@/modules/<module>/public`; implementation folders are private to their module.

## Configuration and hardcoding

- Editable brand copy, contact details, and preview content belong in validated `content/` files.
- Business limits and time rules belong in the owning domain as named exports and have focused tests.
- Colors and shared visual primitives use semantic design tokens. Do not place raw colors in component rules.
- Secrets, origins, provider identifiers, and environment-specific values use a centralized server-only environment schema.
- Do not move unrelated settings into one global configuration object. Preserve ownership and validation boundaries.
- `pnpm check:hardcoding`, `pnpm check:design`, and content schema tests enforce the deterministic portion of these rules.

## Next.js and presentation

- Use Server Components by default; add the smallest possible client boundary for browser interaction.
- Server Actions handle UI-scoped mutations. Public callbacks, webhooks, and external endpoints use Route Handlers.
- Presentation calls application use cases rather than repositories or production tables.
- Business rules, price decisions, authorization, and state transitions remain outside React components.
- Affected UX covers applicable loading, empty, success, validation, business-error, and unexpected-error states.
- Verify semantic HTML, labels, keyboard access, focus behavior, non-color state cues, and mobile layout.

For framework behavior that may have changed, follow the generated rule in root `AGENTS.md` and read only the relevant local Next.js guide.

## Reliability and security

- Validate ownership and roles server-side. Never trust client identity, price, discount, payment status, inventory, or authorization claims.
- External calls define timeout, bounded retry policy, error mapping, and structured logging.
- Webhooks, scheduled jobs, refund commands, notification workers, and fulfillment triggers are idempotent.
- Logs prefer identifiers and correlation IDs. Do not log PII, secrets, raw capability tokens, or full gift messages.
- Validate environment variables centrally and fail early for missing required configuration.
- Never expose server secrets through `NEXT_PUBLIC_*`; separate local, preview, and production credentials.

## Dependencies and generated files

Use pnpm only. Before adding a dependency, check platform or existing alternatives, maintenance, security, license, bundle/runtime impact, and lock-in. Keep only one package-manager lockfile.

Do not hand-edit generated artifacts unless their generator requires it. GitHub Actions references remain pinned to full commit SHAs and are updated through reviewed Dependabot PRs.

## Risk-based verification

Test the changed behavior and likely regression, then choose the smallest sufficient gate:

- L0 documentation/config text: inspect the rendered meaning and run `git diff --check`; validate the specific config when tooling exists.
- L1 presentation: relevant UI check plus typecheck/lint; build when routing, rendering, assets, or framework configuration changed.
- L2 application/domain/dependency: architecture check, focused tests, typecheck/lint, dependency audit when applicable, and build.
- L3 commerce/security/schema: L2 plus failure/retry tests, security review, migration verification, and critical-flow E2E or a documented reason it cannot run.

Do not rerun an unchanged expensive suite after a documentation-only edit. Do rerun a failed or affected gate after its fix. CI executes the full standard suite on PRs.

Command groups:

- `pnpm check:static` — repository, architecture, design, hardcoding, type, and lint policy.
- `pnpm check:ci` — static policy, all tests, and production build.
- `pnpm check:release` — CI, production dependency audit, and production-adapter readiness.

Production readiness is intentionally separate from PR CI while the preview application is being developed. Never weaken it to make a release green.

## Change and PR discipline

- One PR has one coherent responsibility. Separate unrelated UI, domain, and infrastructure changes.
- Search before adding a utility, service, repository, component, hook, schema, type, or library.
- Do not leave commented-out code. A TODO references a tracked issue when one exists.
- Schema changes include the schema definition, migration, affected code/tests, compatibility analysis, and rollback plan.
- A PR explains why, meaningful changes, architecture/security impact, verification evidence, risk, and rollback. Add screenshots when visual behavior changed.
- Architecture decisions use the ADR template; accepted ADRs override earlier undocumented direction.

## Definition of done

A change is done when the requested behavior works, affected failure states are handled, relevant checks pass, migrations/environment changes are explicit, and remaining risks are stated. Reports should be concise and evidence-based; omit empty boilerplate and raw logs.
