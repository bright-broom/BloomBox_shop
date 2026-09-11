# ADR 0004: Referral rewards with a production-disabled preview

- Status: Proposed for review; preview implementation only
- Date: 2026-09-11
- Owners: Product and Architecture
- Extends: ADR 0001 and ADR 0002

## Context

BloomBox needs a reason for customers to introduce friends and return for another gift. The current storefront has a preview checkout, without authenticated customer accounts or an activated Shopify checkout and fulfillment event stream. A browser cookie or a success redirect cannot establish real first-purchase eligibility or authorize a monetary reward.

## Decision

Add a referral module owning attribution, benefit eligibility, coupon consumption, and reward reversal. It exposes its contracts through `public.ts`; checkout reads server-owned catalog prices and calls the referral contract without mutating another module's state. The existing Order, Payment, and Fulfillment models remain independent.

Start with a fixed JPY 500 friend benefit and a JPY 500 referrer benefit, a JPY 5,500 product subtotal minimum, one coupon per order, 90-day validity, and five referrer rewards per Asia/Tokyo calendar month. The friend claims before their first recorded purchase. The referrer receives a benefit only after simulated delivery of that eligible purchase. Refunds revoke unused rewards; already-spent rewards require review. The precise rules and rationale are in the [referral runbook](../../operations/REFERRALS.md).

The implementation is deliberately limited to an interactive preview:

- Both runtime mode and checkout provider must be `preview` at every server action. The page returns not found otherwise. Existing production readiness gates remain unchanged.
- The synchronous, I/O-free preview application model validates before mutation and owns process-local maps. It does not write production commerce tables and is not a persistence adapter suitable for activation.
- Random HttpOnly cookie capabilities identify test personas. Public invitation and coupon identifiers never include the secret cookie value. The buyer identity cannot be selected in a request payload.
- Test payment and delivery/refund controls can affect only test state owned by the current test persona. They must never be reused as authoritative production event inputs.
- The browser submits product ID, quantity, request ID, coupon ID, and expected subtotal. Server catalog price, coupon ownership, expiry, and prior consumption govern the test settlement. Browser price and discount are not authoritative.
- Duplicate order commands return the original result when ownership and purchase fingerprint match. Delivery and reversal are terminal/idempotent. Capacity limits do not prevent an existing order from being replayed.
- No recipient, address, email, phone, or gift message enters the referral program. Existing checkout cleanup remains intact.

Production continues to use Shopify as the commerce and discount source of truth. Activation requires verified customer identity, durable uniqueness and transactions, provider discount issuance/revocation, verified paid/delivered/refunded facts, an inbox/outbox, reconciliation, and abuse controls. A separate implementation and its evidence must satisfy those requirements; switching an environment variable cannot promote this preview model.

## Alternatives

- **Immediate referrer credit on registration:** rejected because it rewards unqualified signups and does not require an actual gift purchase.
- **Percentage discounts or cash payouts:** deferred because fixed amounts are easier to understand and bound. Cash adds payout operations; percentage discounts make acquisition cost depend on basket size.
- **Build live rewards on browser identifiers:** rejected because cookie resets, identity switching, and forged completion events cannot establish eligibility.
- **Add another rewards SaaS now:** deferred until real customer and Shopify checkout integration can support it. No new vendor or dependency is necessary for testing the experience.

## Consequences

The customer journey is testable end to end without issuing real value. The maps, persona switching, simulated events, and capacity behavior are explicitly preview-only and carry no durable financial guarantees. Real users cannot receive a spendable production coupon from this change.

Financial effectiveness remains a hypothesis: the maximum face-value benefit per successful introduction is JPY 1,000, with the referrer's half requiring another qualifying purchase. Margin and repeat-purchase evidence are required before launch; these amounts are not a claim of profitability.

## Rollout and rollback

Review this focused L3 PR and expose `/referrals` only in preview. No database migration, secret, dependency, or provider-side configuration changes are included. Revert this PR to remove the experience; process restart discards test data. Browser cookie expiry is one day, so test identity can expire before the simulated coupon. Do not promise persistence to preview users.

Production rollout needs its own reviewed change, staging provider evidence, operational recovery procedure, and existing release approval. An eventual rollback must stop new grants while honoring or explicitly reconciling already-issued real coupons; deleting the production ledger is never an acceptable rollback.

## Verification

Tests cover self-referral, first-purchase closure, attribution immutability, ownership, expiry, minimum subtotal, non-stacking, duplicate commands, altered replay rejection, Japan month boundaries, refund-before-delivery, unused reward revocation, spent reward review, production gating, price changes, storage capacity replay, and browser receipt binding/cleanup. Manual browser evidence and full-suite results are recorded in the runbook.
