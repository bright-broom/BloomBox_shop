<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# BloomBox agent policy

This is the mandatory, token-efficient policy for the whole repository. An approved ADR wins when it intentionally changes architecture. Otherwise this file wins over convenience.

## 1. Operating model

- Inspect the relevant code and current diff before editing. Extend an existing pattern before creating an abstraction.
- Keep one change focused. Do not refactor unrelated code unless it blocks a safe implementation.
- Prefer the smallest explicit, testable, recoverable solution. Do not add speculative infrastructure.
- Use deterministic checks for facts they can prove; do not duplicate lint, test, or scanner work with long narrative reviews.
- Read guidance progressively. Search headings first and load only the sections needed for the changed surface.
- Do not push directly to `main`. Use a focused PR with risk, verification, and rollback evidence.

## 2. Product and architecture invariants

BloomBox is a gift-experience platform. Optimize in this order: correct orders, safe payments, reliable fulfillment, privacy, recoverability, simple architecture, product speed.

- Architecture: Modular Monolith. Microservices require an ADR.
- Dependency direction: `Presentation → Application → Domain`; Infrastructure implements inward-facing interfaces.
- Domain code stays pure TypeScript and imports no framework, I/O, or vendor SDK.
- A module never mutates another module's tables directly.
- Keep these concepts distinct: Order/Payment/Fulfillment, Buyer/Recipient, Product/Flower/FlowerLot, Customer/User, Gift/Order.
- Business logic and authoritative state transitions do not live in React components.
- ADR 0009 selects BloomBox-owned PostgreSQL commerce and direct Google customer authentication. During migration, Shopify adapters remain legacy integrations; never treat their presence as native-commerce readiness. Payment SDKs and transport models stay behind infrastructure adapters.
- Checked-in catalog JSON and in-memory repositories are preview fixtures; they must never pass the production-readiness gate.
- Cross-module code imports only the owning module's `public.ts` entry point.

Architecture details: [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md).

## 3. Trust, data, and failure invariants

- Treat browser, webhook, external API, environment, and AI data as untrusted; validate at the boundary.
- Never trust client price, discount, tax, payment state, inventory, identity, role, or ownership.
- Calculate money server-side with integer minor units and snapshot purchase-time prices.
- Model Order, Payment, and Fulfillment with explicit state machines, not synchronized booleans.
- Verified provider webhooks—not browser redirects—are authoritative for payment state.
- Make externally triggered writes idempotent and auditable. Expect timeout, retry, duplicate, delay, and reordering.
- Keep atomic database writes in a transaction; do not call external services inside long transactions. Use an outbox for post-commit effects when required.
- Authentication is not authorization. Apply explicit ownership/role checks and least privilege.
- Never log secrets, tokens, card data, full addresses, phone numbers, or full gift messages.
- Buyer and recipient are separate privacy principals. AI and analytics must never block checkout.

## 4. Change-depth routing

Classify by the highest matching level; do not perform a deeper review by default.

| Level | Typical change | Required review |
| --- | --- | --- |
| L0 | Docs, copy, metadata | Diff accuracy and formatting only |
| L1 | UI or presentation without business rules | Accessibility, mobile states, typecheck/lint, relevant build or visual check |
| L2 | Domain, application, API, dependencies | Architecture boundary, relevant tests, typecheck/lint/build, dependency review |
| L3 | Payment, auth, PII, webhook, schema, inventory, fulfillment | L2 plus threat/security review, failure/idempotency analysis, migration or E2E evidence as applicable |

Escalate only for evidence: changed trust boundary, persistence model, provider, module ownership, or critical-path behavior.

## 5. Implementation and verification

- Keep TypeScript strict. Avoid `any`, `@ts-ignore`, and unsafe double assertions; explain a necessary exception.
- Use typed expected errors; never swallow errors. Translate business failures for users and make unexpected failures observable.
- Server Components are the default. Limit client boundaries to browser interaction.
- Add tests for changed behavior and regression risk, not coverage percentage. Critical commerce changes cover failure and repeated execution.
- Run the smallest sufficient local checks for the level above. CI remains authoritative for the full standard suite.
- Use `pnpm check:ci` for the deterministic CI suite. Use `pnpm check:release` only for a production candidate; it also audits production dependencies and rejects preview adapters.
- Put editable site copy in validated `content/` files, business limits in the owning domain policy, design primitives in root CSS tokens, and secrets or environment-specific values in validated server configuration.

Implementation details: [`docs/engineering/DEVELOPMENT.md`](docs/engineering/DEVELOPMENT.md).

## 6. Progressive document lookup

Do not preload every document.

- Module, dependency, state, transaction, provider, or data-model change → architecture guide and relevant ADR only.
- Code, Next.js, validation, tests, dependency, or PR mechanics → development guide, relevant section only.
- UI pattern, token, accessibility, or visual-state change → [`docs/design/DESIGN_SYSTEM.md`](docs/design/DESIGN_SYSTEM.md).
- Ownership, review, deployment, or production-readiness change → the relevant document in [`docs/operations`](docs/operations).
- Security-sensitive change → [`SECURITY.md`](SECURITY.md) plus the affected architecture section.
- Next.js behavior → the generated Next.js rule above and the exact relevant local framework guide.

## 7. Completion report

Report only material outcomes: behavior changed, architecture/security decisions, checks actually run, migration/environment impact, risks, and remaining work. Omit empty sections and do not repeat raw command output.
