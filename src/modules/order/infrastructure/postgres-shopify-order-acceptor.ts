import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assessDeliveryDate, assessDeliveryDestination, isApprovedDeliveryCoverage, normalizePostalCode,
  DELIVERY_ADDRESS_TEXT_MAX_LENGTH, DELIVERY_POSTAL_INPUT_MAX_LENGTH } from "@/modules/fulfillment/public";
import { RECIPIENT_NAME_MAX_LENGTH, GIFT_MESSAGE_MAX_LENGTH } from "@/modules/checkout/public";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { assessOrderPricing } from "../domain/order-pricing";
import { SHOPIFY_ORDER_ACCEPTANCE_POLICY, ShopifyOrderAcceptanceConflictError, ShopifyOrderAcceptancePersistenceError,
  type ShopifyOrderAcceptance, type ShopifyOrderAcceptancePolicy, type ShopifyOrderAcceptanceResult, type ShopifyOrderAcceptor } from "../application/accept-shopify-order";

const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const gid = (resource: string) => z.string().max(100).regex(new RegExp(`^gid://shopify/${resource}/[1-9]\\d*$`));
const text = z.string().max(DELIVERY_ADDRESS_TEXT_MAX_LENGTH).nullable();
const pricingSchema = z.object({
  taxesIncluded: z.boolean(), estimatedTaxes: z.boolean(), edited: z.boolean(), subtotal: minor, currentSubtotal: minor,
  tax: minor, currentTax: minor, total: minor, originalTotal: minor, currentTotal: minor, currentShipping: minor,
  duties: minor, currentDuties: minor, additionalFees: minor, currentAdditionalFees: minor, tips: minor,
  lines: z.array(z.object({ quantity: minor, currentQuantity: minor, unitPrice: minor,
    discounts: z.array(minor).max(100), taxes: z.array(minor).max(100) })).length(1),
  shipping: z.array(z.object({ originalPrice: minor, discountedPrice: minor, currentDiscountedPrice: minor,
    removed: z.boolean(), taxes: z.array(minor).max(100) })).length(1),
});
const inputSchema = z.object({
  purchaseIntentId: z.uuid(), attemptId: z.uuid(), shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  orderId: gid("Order"), variantId: gid("ProductVariant"), paymentVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime({ offset: true }), pricing: pricingSchema,
  address: z.object({ countryCode: z.string().max(2).nullable(), prefecture: text,
    postalCode: z.string().max(DELIVERY_POSTAL_INPUT_MAX_LENGTH).nullable(), recipientName: text, city: text, addressLine: text,
    addressLine2: text, phone: z.string().max(32).nullable() }),
});
const recipientSchema = z.object({ name: z.string().trim().min(1).max(RECIPIENT_NAME_MAX_LENGTH) });
function conflict(): never { throw new ShopifyOrderAcceptanceConflictError(); }

/** Disabled by default. Writes only Order-owned records; authoritative Checkout/Payment rows are locked read-only. */
export class PostgresShopifyOrderAcceptor implements ShopifyOrderAcceptor {
  constructor(private readonly sql: DatabaseClient, private readonly protector: AesGcmDataProtector,
    private readonly policy: ShopifyOrderAcceptancePolicy = SHOPIFY_ORDER_ACCEPTANCE_POLICY,
    private readonly now: () => Date = () => new Date(), private readonly createId: () => string = randomUUID) {}

  async accept(input: ShopifyOrderAcceptance): Promise<ShopifyOrderAcceptanceResult> {
    if (this.policy.approval !== "APPROVED" || !isApprovedDeliveryCoverage(this.policy.coverage)) {
      return { outcome: "HELD", reason: "TERMS_NOT_APPROVED" };
    }
    const policy = this.policy;
    if (!Number.isSafeInteger(policy.piiRetentionDays) || policy.piiRetentionDays <= 0 || typeof policy.taxesIncluded !== "boolean" || typeof policy.testMode !== "boolean") conflict();
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) conflict();
    const value = parsed.data;
    const pricing = assessOrderPricing(value.pricing);
    if (pricing.status !== "MATCHED") return { outcome: "HELD", reason: "PRICING_UNRESOLVED" };
    const price = pricing.snapshot;
    if (assessDeliveryDestination(value.address, policy.coverage).status !== "STRUCTURALLY_VALID_AND_COVERED") {
      return { outcome: "HELD", reason: "ADDRESS_UNRESOLVED" };
    }
    // Discount eligibility and redemption are not yet connected to durable commerce.
    if (price.discount !== 0) return { outcome: "HELD", reason: "DISCOUNTS_UNSUPPORTED" };
    if (price.taxesIncluded !== policy.taxesIncluded) return { outcome: "HELD", reason: "TERMS_MISMATCH" };
    try {
      return await this.sql.begin(async (tx) => {
        // Same first lock as checkout completion/association; never call a provider inside this transaction.
        const intents = await tx`SELECT id, status, commerce_provider, currency, delivery_date::text AS delivery_date,
          pii_key_id, recipient_ciphertext, gift_message_ciphertext, pii_purged_at, pii_retention_expires_at
          FROM bloombox.purchase_intents WHERE id = ${value.purchaseIntentId} FOR UPDATE`;
        const intent = intents[0];
        const links = await tx`SELECT attempt_id, provider_scope, external_order_id FROM bloombox.shopify_order_links
          WHERE purchase_intent_id = ${value.purchaseIntentId}`;
        if (!intent || intent.commerce_provider !== "SHOPIFY" || intent.currency !== "JPY"
          || links[0]?.attempt_id !== value.attemptId || links[0]?.provider_scope !== value.shop || links[0]?.external_order_id !== value.orderId) conflict();
        const existing = await tx`SELECT orders.id, orders.display_id, orders.commerce_provider, orders.external_order_id,
          receipt.provider_scope, receipt.purchase_intent_id
          FROM bloombox.orders AS orders LEFT JOIN bloombox.shopify_order_acceptances AS receipt ON receipt.order_id = orders.id
          WHERE orders.purchase_intent_id = ${value.purchaseIntentId}`;
        if (existing.length) {
          const old = existing[0];
          if (existing.length !== 1 || old.commerce_provider !== "SHOPIFY" || old.external_order_id !== value.orderId
            || old.provider_scope !== value.shop || old.purchase_intent_id !== value.purchaseIntentId) conflict();
          return { outcome: "DUPLICATE", orderId: z.uuid().parse(old.id), displayId: z.string().parse(old.display_id) };
        }
        const payments = await tx`SELECT provider_scope, external_order_id, status, version, captured_minor, refunded_minor, snapshot
          FROM bloombox.shopify_payment_evidence WHERE purchase_intent_id = ${value.purchaseIntentId} FOR SHARE`;
        const payment = payments[0];
        if (!payment || payment.provider_scope !== value.shop || payment.external_order_id !== value.orderId) conflict();
        const evidence = z.object({ test: z.boolean(), updatedAt: z.iso.datetime({ offset: true }), cancelledAt: z.string().nullable(), requested: minor,
          transactions: z.array(z.object({ status: z.enum(["PENDING", "SUCCEEDED", "FAILED"]) })).max(100) }).parse(payment.snapshot);
        if (evidence.test !== policy.testMode) return { outcome: "HELD", reason: "TERMS_MISMATCH" };
        if (payment.version !== value.paymentVersion || Date.parse(evidence.updatedAt) !== Date.parse(value.updatedAt)) return { outcome: "HELD", reason: "STALE_PAYMENT" };
        if (payment.status !== "CAPTURED" || evidence.cancelledAt !== null || String(payment.captured_minor) !== String(price.total)
          || String(payment.refunded_minor) !== "0" || evidence.requested !== price.total
          || evidence.transactions.some((transaction) => transaction.status === "PENDING")) return { outcome: "HELD", reason: "PAYMENT_UNSETTLED" };
        const items = await tx`SELECT catalog_product_id, external_product_id, product_name_snapshot, quantity, unit_amount_minor, currency
          FROM bloombox.purchase_intent_items WHERE purchase_intent_id = ${value.purchaseIntentId}`;
        const item = items[0]; const line = price.items[0];
        if (items.length !== 1 || item.external_product_id !== value.variantId || item.currency !== "JPY"
          || item.quantity !== line.quantity || String(item.unit_amount_minor) !== String(line.unitPrice)) conflict();
        const shipping = Object.hasOwn(policy.shippingByProduct, item.catalog_product_id) ? policy.shippingByProduct[item.catalog_product_id] : undefined;
        if (!Number.isSafeInteger(shipping) || shipping !== price.shipping) return { outcome: "HELD", reason: "TERMS_MISMATCH" };
        const now = this.now();
        const retention = new Date(now.getTime() + policy.piiRetentionDays * 86_400_000);
        if (!Number.isFinite(now.getTime()) || !Number.isFinite(retention.getTime())) conflict();
        if (intent.status !== "CHECKOUT_CREATED" || intent.pii_purged_at !== null || !intent.pii_key_id
          || !intent.recipient_ciphertext || !intent.gift_message_ciphertext || z.date().parse(intent.pii_retention_expires_at) <= now) {
          return { outcome: "HELD", reason: "PURCHASE_UNAVAILABLE" };
        }
        if (assessDeliveryDate(z.iso.date().parse(intent.delivery_date), now).status !== "WITHIN_WINDOW") return { outcome: "HELD", reason: "DELIVERY_UNAVAILABLE" };
        const orderId = z.uuid().parse(this.createId());
        const displayId = `BBO-${orderId.toUpperCase()}`;
        const recipient = recipientSchema.parse(JSON.parse(this.protector.unprotect({ keyId: intent.pii_key_id, ciphertext: intent.recipient_ciphertext }, `purchase-intent:${value.purchaseIntentId}:recipient:v1`)));
        const message = z.string().max(GIFT_MESSAGE_MAX_LENGTH).parse(this.protector.unprotect({ keyId: intent.pii_key_id, ciphertext: intent.gift_message_ciphertext }, `purchase-intent:${value.purchaseIntentId}:gift-message:v1`));
        const protectedRecipient = this.protector.protect(JSON.stringify(recipient), `order:${orderId}:recipient:v1`);
        const protectedMessage = this.protector.protect(message, `order:${orderId}:gift-message:v1`);
        const protectedAddress = this.protector.protect(JSON.stringify({ ...value.address, postalCode: normalizePostalCode(value.address.postalCode ?? "") }), `order:${orderId}:address:v1`);
        if (protectedRecipient.keyId !== protectedMessage.keyId || protectedRecipient.keyId !== protectedAddress.keyId) conflict();
        await tx`INSERT INTO bloombox.orders (id, display_id, purchase_intent_id, status, commerce_provider, external_order_id, currency,
          subtotal_minor, tax_minor, included_tax_minor, shipping_minor, discount_minor, total_minor, confirmed_at, created_at, updated_at)
          VALUES (${orderId}, ${displayId}, ${value.purchaseIntentId}, 'CONFIRMED', 'SHOPIFY', ${value.orderId}, 'JPY',
            ${price.subtotal}, ${price.additionalTax}, ${price.includedTax}, ${price.shipping}, ${price.discount}, ${price.total}, ${now}, ${now}, ${now})`;
        await tx`INSERT INTO bloombox.order_items (id, order_id, catalog_product_id, external_product_id, product_name_snapshot, quantity,
          unit_amount_minor, tax_minor, included_tax_minor, discount_minor, line_total_minor, currency, position)
          VALUES (${this.createId()}, ${orderId}, ${item.catalog_product_id}, ${item.external_product_id}, ${item.product_name_snapshot}, ${line.quantity},
            ${line.unitPrice}, ${line.additionalTax}, ${line.includedTax}, ${line.discount}, ${line.total}, 'JPY', 0)`;
        await tx`INSERT INTO bloombox.order_gift_snapshots (order_id, delivery_date, pii_key_id, recipient_ciphertext, address_ciphertext, gift_message_ciphertext, retention_expires_at)
          VALUES (${orderId}, ${intent.delivery_date}, ${protectedRecipient.keyId}, ${protectedRecipient.ciphertext}, ${protectedAddress.ciphertext}, ${protectedMessage.ciphertext}, ${retention})`;
        await tx`INSERT INTO bloombox.shopify_order_acceptances (order_id, purchase_intent_id, provider_scope, external_order_id,
          payment_evidence_version, source_updated_at, price_snapshot, accepted_at)
          VALUES (${orderId}, ${value.purchaseIntentId}, ${value.shop}, ${value.orderId}, ${value.paymentVersion}, ${value.updatedAt}, ${tx.json(price)}, ${now})`;
        await tx`INSERT INTO bloombox.order_status_transitions (id, order_id, from_status, to_status, reason_code, actor_type, idempotency_key, occurred_at)
          VALUES (${this.createId()}, ${orderId}, NULL, 'CONFIRMED', 'SHOPIFY_ORDER_ACCEPTED', 'SYSTEM', ${`shopify-order-acceptance:${value.purchaseIntentId}`}, ${now})`;
        const metadata = { orderId, purchaseIntentId: value.purchaseIntentId, provider: "SHOPIFY", paymentVersion: value.paymentVersion, total: price.total, currency: "JPY" };
        await tx`INSERT INTO bloombox.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, available_at)
          VALUES (${this.createId()}, 'Order', ${orderId}, 'order.shopify.accepted', 1, ${tx.json(metadata)}, ${now}, ${now})`;
        await tx`INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
          VALUES (${this.createId()}, 'SYSTEM', 'order.shopify.accepted', 'Order', ${orderId}, ${tx.json(metadata)}, ${now})`;
        return { outcome: "CREATED", orderId, displayId };
      });
    } catch (error) {
      if (error instanceof ShopifyOrderAcceptanceConflictError) throw error;
      if (error instanceof Error && "code" in error && ["23503", "23505"].includes(String(error.code))) conflict();
      throw new ShopifyOrderAcceptancePersistenceError();
    }
  }
}
