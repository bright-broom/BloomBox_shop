# Security Policy

## Supported versions

Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting for this repository, or contact the repository owner
privately. Include the affected path, impact, reproduction steps, and any known
mitigation. You should receive an acknowledgement within three business days.

## Engineering controls

Every pull request must pass CodeQL, production dependency auditing, architecture
boundary checks, type checking, linting, unit tests, and a production build.
Domain code must remain framework-independent. External input must be validated at
the presentation boundary, and provider SDKs must remain in infrastructure code.
