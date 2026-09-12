# Shopify Storefront catalog connection

Shopify remains the authoritative source for the production catalog, JPY price, publication state, and variant availability under ADR 0001. The checked-in JSON catalog is used only when `BLOOMBOX_RUNTIME_MODE=preview`.

## Fixed integration contract

- Storefront API version: `2026-07`, pinned in source and in the GraphQL endpoint. Successful responses must report the same `X-Shopify-API-Version`; missing headers and automatic version fallback are rejected. [Shopify version-header contract](https://shopify.dev/docs/api/usage/versioning#making-requests-to-an-api-version).
- Endpoint: `https://<shop>.myshopify.com/api/2026-07/graphql.json`; configuration rejects protocols, custom hosts, localhost, and suffix-confusion domains.
- Authentication: Storefront access token sent only from the server through `X-Shopify-Storefront-Access-Token`. When the hosting request exposes a valid client address, the adapter forwards it through `Shopify-Storefront-Buyer-IP` for Shopify bot protection and traffic attribution.
- Market context: Japan and Japanese with JPY prices.
- Catalog inclusion: published products tagged with the exact `SHOPIFY_CATALOG_TAG`, which defaults to `bloombox`.
- Sellable unit: exactly one ProductVariant per tagged product. Its Shopify GID is the external commerce reference retained on PurchaseIntent and Order item snapshots.
- Failure behavior: ambiguous variants, mismatched requested IDs/handles, missing curated content, non-JPY or invalid decimal prices, duplicate handles, unexpected image hosts, GraphQL errors, and oversized responses fail closed. JPY amounts may contain only decimal digits with an optional zero fractional part; scientific/hexadecimal notation, blanks, fractional yen, negatives and unsafe integers are rejected.
- Lookup consistency: listing, handle lookup and purchase-time ID lookup enforce the same single-variant contract. An ID lookup validates both the returned node ID and its parent’s sole variant. Public IDs must use their canonical encoding; alternate spellings do not create another purchase identity.

The catalog page is rendered dynamically. The adapter reads at most 50 products per page and 20 pages per request. Responses are read incrementally with a 2,000,000-byte cap before JSON parsing; exceeding the cap cancels the remaining stream. The eight-second deadline covers both headers and body. Rejected HTTP responses are discarded before retrying or failing. Network timeouts, `429`, `5xx`, and retryable GraphQL `THROTTLED` or `INTERNAL_SERVER_ERROR` responses use a bounded three-attempt retry. Without a numeric Retry-After, HTTP retries wait 100ms and 200ms; explicit numeric values are capped at two seconds. Invalid payloads and incompatible API versions are not retried. Requests explicitly disable caching. Checkout preparation performs a fresh server-side lookup, so browser-supplied names, prices, availability, and Shopify identifiers are never trusted. The hosting proxy must replace untrusted forwarding headers so the buyer IP sent to Shopify is platform-verified.

## Shopify Admin setup

1. Create or select the custom app that owns the headless Storefront connection.
2. Grant the minimum unauthenticated Storefront scope needed to read product listings and create a Storefront access token. Keep the token in server environment configuration even though Shopify classifies public Storefront tokens separately from Admin secrets.
3. Publish each BloomBox product to the headless sales channel and apply the exact `bloombox` tag, or the reviewed value of `SHOPIFY_CATALOG_TAG`.
4. Configure exactly one sellable variant with a JPY price. Multi-variant selection is intentionally unsupported until the Product UX and PurchaseIntent model explicitly support options.
5. Enable Storefront access for these `bloombox` metafield definitions:

| Namespace | Key | Shopify type | Purpose |
| --- | --- | --- | --- |
| `bloombox` | `subtitle` | Single line text | Product-card supporting copy |
| `bloombox` | `palette` | Single line text | Visual palette label |
| `bloombox` | `occasion` | List of single line text | Recommended occasions |
| `bloombox` | `flowers` | List of single line text | Flower materials |
| `bloombox` | `grower` | Single line text | Grower attribution |

6. Add a featured image with meaningful alt text. The current image boundary accepts Shopify CDN URLs only.
7. Record the app owner, token rotation owner, API-version upgrade date, fallback Shopify storefront URL, and support escalation path in the private credential inventory.

## Runtime configuration

```text
BLOOMBOX_RUNTIME_MODE=production
SHOPIFY_STORE_DOMAIN=<shop>.myshopify.com
SHOPIFY_STOREFRONT_ACCESS_TOKEN=<storefront-access-token>
SHOPIFY_CATALOG_TAG=bloombox
```

Do not use `NEXT_PUBLIC_*`. Preview deployments must use fixtures or an isolated test store and must not inherit production configuration.

## Connection evidence

Before approving production activation, attach sanitized evidence for:

- empty, one-page, and paginated catalog responses;
- tag exclusion and unpublished products;
- sold-out and price-changed variants;
- missing metafields, a second variant, non-JPY price, missing image, and malformed GraphQL data;
- token rejection, locked or unavailable shop, timeout, throttle recovery, and provider outage;
- product handle change, token rotation, API-version upgrade, and Shopify-hosted fallback;
- the same Shopify Variant GID and price snapshot flowing from catalog lookup into PurchaseIntent, the selected Shopify cart handoff, Order item, and reconciliation evidence.

Provider contract fixtures must be sanitized and checked into tests. Never copy customer, order, or production token data into the repository.

## Catalog boundary regression verification — 2026-09-11

The initial regression run reproduced nine failures: ID lookup bypassed the single-variant rule, accepted a different returned ID, numeric conversion accepted blank/hex/exponent strings, the API version was unchecked, and oversized bodies were fully consumed before rejection. The corrected boundary has regression tests for those cases, mismatched parent variant/handle, fresh price and availability, canonical IDs, an exact-size multibyte response, unauthorized/invalid responses, retry exhaustion, and a response body that stalls until timeout.

Local verification: `pnpm check:ci` passed with 267 tests (including 28 catalog boundary tests), typecheck, lint, architecture/design/repository checks, and production build. Seven existing database tests skipped locally without a database; CI runs them in PostgreSQL. `git diff --check` passed. No visual re-test was needed because this change affects only the server catalog boundary.

These are synthetic contract tests without a Shopify account. They do not prove merchant configuration, live availability, payment, or two-variant M/L support. Production M/L mapping and the durable Shopify checkout attempt remain separate work. No production flag, fixture pricing, storefront palette, dependency, secret or database schema changes.

Rollback: revert the catalog validation change if required; it has no persisted data or provider mutation. Prefer correcting the store configuration or reviewing an API version update over bypassing validation. Keep the existing production release gate and merchant evidence requirements.
