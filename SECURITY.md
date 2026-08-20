# Security Policy

## Supported versions

Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting for this repository, or contact the repository owner
privately. Include the affected path, impact, reproduction steps, and any known
mitigation. You should receive an acknowledgement within three business days.

## Engineering controls

Every pull request must pass the deterministic Semgrep rule set, production
dependency auditing, repository and architecture policy, type checking, linting,
unit tests, and a production build. GitHub Actions are pinned to immutable commit
SHAs and dependency updates are reviewed.

Domain code must remain framework-independent. External, content, webhook, and
provider data must be runtime-validated at its boundary, and provider SDKs must
remain in infrastructure code. Secrets and customer or recipient PII must not be
committed or logged. Production deployment additionally requires the protected
release gate described in `docs/operations/RELEASE.md`.
