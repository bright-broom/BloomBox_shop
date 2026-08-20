# BloomBox Design System

This document defines the product and implementation rules that keep the BloomBox experience coherent as pages, campaigns, products, and contributors increase.

## Experience principles

1. The recipient and the sender should always understand the next action.
2. Emotional storytelling may enrich the journey, but it must not obscure price, delivery, availability, or validation state.
3. Trust is communicated through precise facts and calm recovery states, not unsupported sustainability claims.
4. Mobile and keyboard interaction are primary acceptance conditions, not follow-up polish.
5. Reuse a purposeful component or token before introducing a near-duplicate.

## Single source of truth

| Concern | Authoritative location | Rule |
| --- | --- | --- |
| Brand and page copy | `content/site.json` | Editable copy and contact details do not live in components. |
| Preview product content | `content/catalog.json` | Runtime-validated fixture only; Shopify replaces it in production. |
| Color and visual primitives | `src/app/globals.css` `:root` | Components use semantic CSS custom properties. |
| Business limits | Owning domain policy | Limits such as gift-message length are exported, tested constants. |
| Environment-specific values | Validated server configuration | Secrets and deployment URLs never enter content files or client code. |

Do not create a generic settings file that mixes these categories. Their validation, ownership, sensitivity, and release cadence differ.

## Tokens and components

- Token names express purpose, such as `--danger` or `--ink-muted`, rather than a one-off page location.
- Raw hex, RGB, HSL, and named colors are allowed only in the root token declaration. `pnpm check:design` enforces this.
- A repeated spacing, radius, typography, elevation, or motion value becomes a token when it represents a system choice rather than incidental layout.
- Components expose meaningful variants and states. Do not add boolean combinations that create invalid visual states.
- Shared components include their accessible name, focus behavior, disabled behavior, loading behavior, and error behavior in the component contract.
- Product-specific composition stays near the feature until reuse is demonstrated.

## Required states

Every affected flow evaluates the applicable states:

- loading or pending;
- empty;
- success;
- unavailable or disabled;
- validation error;
- recoverable business error;
- unexpected error;
- slow network and repeated submission.

State cannot be communicated by color alone. Error summaries and form controls must be associated programmatically. Motion respects reduced-motion preferences.

## Responsive and content resilience

- Review the narrowest supported mobile width, a common desktop width, and 200% browser zoom.
- Allow Japanese and English text, long product names, missing optional copy, and realistic error messages without clipping.
- Images declare meaningful alternative text or are explicitly decorative. Crop behavior must preserve the product's focal point.
- Touch targets, focus order, and sticky controls must remain usable with the software keyboard open.

## Review evidence

An L1 or higher visual PR includes screenshots or recordings for affected mobile and desktop states. The reviewer checks hierarchy, content accuracy, keyboard use, responsive behavior, and regressions against existing patterns. Automated token, type, lint, and build checks support this review but do not replace perceptual judgment.

A new design pattern documents its purpose, states, accessibility contract, and replacement or migration plan before broad rollout.
