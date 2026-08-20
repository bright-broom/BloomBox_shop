# Shopify Storefront catalog connection

Shopify remains the authoritative source for the production catalog, JPY price, publication state, and variant availability under ADR 0001. The checked-in JSON catalog is used only when `BLOOMBOX_RUNTIME_MODE=preview`.

## Fixed integration contract

- Storefront API version: `2026-07`, pinned in source and in the GraphQL endpoint.
- Endpoint: `https://<shop>.myshopify.com/api/2026-07/graphql.json`; configuration rejects protocols, custom hosts, localhost, and suffix-confusion domains.
- Authentication: Storefront access token sent only from the server through `X-Shopify-Storefront-Access-Token`. When the hosting request exposes a valid client address, the adapter forwards it through `Shopify-Storefront-Buyer-IP` for Shopify bot protection and traffic attribution.
- Market context: Japan and Japanese with JPY prices.
- Catalog inclusion: published products tagged with the exact `SHOPIFY_CATALOG_TAG`, which defaults to `bloombox`.
- Sellable unit: exactly one ProductVariant per tagged product. Its Shopify GID is the external commerce reference retained on PurchaseIntent and Order item snapshots.
- Failure behavior: ambiguous variants, missing curated content, non-JPY prices, duplicate handles, unexpected image hosts, GraphQL errors, and oversized responses fail closed.

The catalog page is rendered dynamically. The adapter reads at most 50 products per page and 20 pages per request. Network timeouts, `429`, `5xx`, and retryable GraphQL `THROTTLED` or `INTERNAL_SERVER_ERROR` responses use a bounded three-attempt retry. Checkout preparation performs a fresh server-side lookup, so browser-supplied names, prices, availability, and Shopify identifiers are never trusted. The hosting proxy must replace untrusted forwarding headers so the buyer IP sent to Shopify is platform-verified.

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
- the same Shopify Variant GID and price snapshot flowing from catalog lookup into PurchaseIntent, Stripe metadata, Order item, and reconciliation evidence.

Provider contract fixtures must be sanitized and checked into tests. Never copy customer, order, or production token data into the repository.
