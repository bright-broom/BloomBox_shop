import { restoreLoyaltyQuote } from "@/modules/customer/public";
import { InventoryUnavailableError, type InventoryReservations } from "@/modules/inventory/public";
import type { CheckoutBuyerWriter } from "@/modules/customer/public";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ProviderEventProcessor,
  VerifiedProviderEvent,
} from "../application/receive-provider-webhook";
import type {
  DatabaseClient,
  DatabaseTransaction,
} from "@/shared/infrastructure/database/postgres-client";
import type { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { BUSINESS_TIME_ZONE } from "@/shared/domain/time";

const checkoutPayloadSchema = z.object({
  objectType: z.literal("checkout_session"),
  id: z.string().startsWith("cs_"),
  purchaseIntentId: z.string().uuid(),
  paymentIntentId: z.string().startsWith("pi_").nullable(),
  paymentStatus: z.string(),
  checkoutStatus: z.string().nullable(),
  amountTotal: z.number().int().nonnegative().nullable(),
  amountSubtotal: z.number().int().nonnegative().nullable(),
  currency: z.string().nullable(),
  totalDetails: z.object({
    amount_discount: z.number().int().nonnegative(),
    amount_shipping: z.number().int().nonnegative().nullable(),
    amount_tax: z.number().int().nonnegative(),
  }).nullable(),
  customerId: z.string().startsWith("cus_").nullable(),
  customerDetails: z.record(z.string(), z.unknown()).nullable(),
  collectedInformation: z.record(z.string(), z.unknown()).nullable(),
});

const refundPayloadSchema = z.object({
  objectType: z.literal("refund"),
  id: z.string().startsWith("re_"),
  paymentIntentId: z.string().startsWith("pi_"),
  amount: z.number().int().positive(),
  currency: z.string(),
  status: z.string().nullable(),
  reason: z.string().nullable(),
  failureReason: z.string().nullable(),
});

const disputePayloadSchema = z.object({
  objectType: z.literal("dispute"),
  id: z.string().startsWith("dp_"),
  paymentIntentId: z.string().startsWith("pi_"),
  amount: z.number().int().positive(),
  currency: z.string(),
  reason: z.string(),
  status: z.string(),
});

const purchaseIntentRowSchema = z.object({
  id: z.string().uuid(),
  display_id: z.string(),
  commerce_provider: z.literal("STRIPE"),
  status: z.string(),
  external_checkout_id: z.string().nullable(),
  currency: z.literal("JPY"),
  subtotal_minor: integerValueSchema(),
  shipping_minor: integerValueSchema().nullable().default(null),
  loyalty_snapshot: z.unknown().default(null),
  loyalty_discount_minor: integerValueSchema().default(0),
  customer_id: z.uuid().nullable().default(null),
  delivery_date: z.string(),
  pii_key_id: z.string().nullable(),
  recipient_ciphertext: z.instanceof(Buffer).nullable(),
  gift_message_ciphertext: z.instanceof(Buffer).nullable(),
  created_at: z.union([z.string(), z.date()]),
  catalog_product_id: z.string(),
  external_product_id: z.string(),
  product_name_snapshot: z.string(),
  quantity: z.number().int().positive(),
  unit_amount_minor: integerValueSchema(),
  item_subtotal_minor: integerValueSchema(),
});

const recipientPayloadSchema = z.object({ name: z.string().min(1) });

export class InvalidStripeCommerceEventError extends Error {
  constructor() {
    super("Stripe commerce event is inconsistent with persisted state");
    this.name = "InvalidStripeCommerceEventError";
  }
}

export class StripeCommerceEventDependencyError extends Error {
  constructor() {
    super("Stripe commerce event depends on an event that has not been processed");
    this.name = "StripeCommerceEventDependencyError";
  }
}

export class StripeCommerceEventProcessor implements ProviderEventProcessor {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly protector: AesGcmDataProtector,
    private readonly taxBehavior: "inclusive" | "exclusive" | "unspecified",
    private readonly buyerWriter: (transaction: DatabaseTransaction) => CheckoutBuyerWriter,
    private readonly createId: () => string = randomUUID,
    private readonly inventory?: (tx: DatabaseTransaction) => InventoryReservations,
  ) {}

  async process(event: VerifiedProviderEvent): Promise<void> {
    if (event.provider !== "STRIPE") throw new InvalidStripeCommerceEventError();
    if (event.eventType.startsWith("checkout.session.")) {
      await this.processCheckoutEvent(event);
      return;
    }
    if (event.eventType.startsWith("refund.")) {
      await this.processRefundEvent(event);
      return;
    }
    if (event.eventType.startsWith("charge.dispute.")) {
      await this.processDisputeEvent(event);
      return;
    }
    await this.recordAudit(event, "provider.event.observed");
  }

  private async processCheckoutEvent(event: VerifiedProviderEvent): Promise<void> {
    const payload = checkoutPayloadSchema.safeParse(event.payload);
    if (!payload.success) throw new InvalidStripeCommerceEventError();

    if (event.externalObjectId !== payload.data.id) throw new InvalidStripeCommerceEventError();
    if (event.eventType === "checkout.session.expired") {
      if (payload.data.checkoutStatus !== "expired" || payload.data.paymentStatus !== "unpaid") throw new InvalidStripeCommerceEventError();
      await this.transitionPurchaseIntent(event, payload.data.purchaseIntentId, "EXPIRED");
      return;
    }
    if (event.eventType === "checkout.session.async_payment_failed") {
      if (payload.data.paymentStatus !== "unpaid") throw new InvalidStripeCommerceEventError();
      await this.transitionPurchaseIntent(event, payload.data.purchaseIntentId, "ABANDONED");
      return;
    }
    if (payload.data.paymentStatus !== "paid") {
      await this.recordAudit(event, "checkout.awaiting_payment");
      return;
    }
    await this.confirmPaidCheckout(event, payload.data);
  }

  private async confirmPaidCheckout(
    event: VerifiedProviderEvent,
    payload: z.infer<typeof checkoutPayloadSchema>,
  ): Promise<void> {
    if (
      !payload.paymentIntentId
      || payload.amountTotal === null
      || payload.amountSubtotal === null
      || !payload.currency
      || !payload.totalDetails
    ) {
      throw new InvalidStripeCommerceEventError();
    }
    const paymentIntentId = payload.paymentIntentId;
    const amountTotal = payload.amountTotal;
    const amountSubtotal = payload.amountSubtotal;
    const currency = payload.currency;
    const totalDetails = payload.totalDetails;

    await this.sql.begin(async (transaction) => {
      const rows = await transaction`
        SELECT
          intent.id,
          intent.display_id,
          intent.commerce_provider,
          intent.status,
          intent.external_checkout_id,
          intent.currency,
          intent.subtotal_minor,
          intent.shipping_minor,
          intent.loyalty_snapshot,
          intent.loyalty_discount_minor,
          intent.customer_id,
          intent.delivery_date::text,
          intent.pii_key_id,
          intent.recipient_ciphertext,
          intent.gift_message_ciphertext,
          intent.created_at,
          item.catalog_product_id,
          item.external_product_id,
          item.product_name_snapshot,
          item.quantity,
          item.unit_amount_minor,
          item.subtotal_minor AS item_subtotal_minor
        FROM bloombox.purchase_intents AS intent
        JOIN bloombox.purchase_intent_items AS item
          ON item.purchase_intent_id = intent.id AND item.position = 0
        WHERE intent.id = ${payload.purchaseIntentId}
        FOR UPDATE OF intent
      `;
      const parsed = purchaseIntentRowSchema.safeParse(rows[0]);
      if (!parsed.success) throw new StripeCommerceEventDependencyError();
      const intent = parsed.data;

      if (intent.status === "CONVERTED") return;
      if (intent.status !== "CHECKOUT_CREATED" || intent.external_checkout_id !== payload.id) {
        throw new InvalidStripeCommerceEventError();
      }
      if (
        intent.pii_key_id === null
        || intent.recipient_ciphertext === null
        || intent.gift_message_ciphertext === null
      ) {
        throw new StripeCommerceEventDependencyError();
      }

      const itemSubtotal = toSafeInteger(intent.item_subtotal_minor);
      const loyalty = intent.loyalty_snapshot === null ? null : restoreLoyaltyQuote(intent.loyalty_snapshot, itemSubtotal);
      const loyaltyDiscount = loyalty?.discountYen ?? 0;
      if (loyaltyDiscount !== toSafeInteger(intent.loyalty_discount_minor) || (loyalty !== null && (
        !intent.customer_id || !intent.catalog_product_id.startsWith("native_") || intent.quantity !== 1
        || intent.shipping_minor === null || totalDetails.amount_discount !== 0
      ))) throw new InvalidStripeCommerceEventError();
      const netSubtotal = itemSubtotal - loyaltyDiscount;
      if (
        currency.toUpperCase() !== intent.currency
        || amountSubtotal !== netSubtotal
        || toSafeInteger(intent.subtotal_minor) !== itemSubtotal
      ) {
        throw new InvalidStripeCommerceEventError();
      }
      const shipping = totalDetails.amount_shipping ?? 0;
      const discount = totalDetails.amount_discount + loyaltyDiscount;
      const reportedTax = totalDetails.amount_tax;
      const tax = this.taxBehavior === "exclusive" ? reportedTax : 0;
      const includedTax = this.taxBehavior === "inclusive" ? reportedTax : 0;
      if (intent.shipping_minor !== null && (
        totalDetails.amount_shipping === null || shipping !== toSafeInteger(intent.shipping_minor) || totalDetails.amount_discount !== 0
        || this.taxBehavior !== "inclusive" || amountTotal !== netSubtotal + shipping
      )) throw new InvalidStripeCommerceEventError();
      if (this.taxBehavior === "unspecified" && reportedTax !== 0) {
        throw new InvalidStripeCommerceEventError();
      }
      if (itemSubtotal + tax + shipping - discount !== amountTotal) {
        throw new InvalidStripeCommerceEventError();
      }

      const orderId = this.createId();
      const buyerId = this.createId();
      const recipientId = this.createId();
      const paymentId = this.createId();
      const fulfillmentId = this.createId();
      const recipient = parseJson(
        this.protector.unprotect({
          keyId: intent.pii_key_id,
          ciphertext: intent.recipient_ciphertext,
        }, purchaseIntentRecipientContext(intent.id)),
        recipientPayloadSchema,
      );
      const giftMessage = this.protector.unprotect({
        keyId: intent.pii_key_id,
        ciphertext: intent.gift_message_ciphertext,
      }, purchaseIntentGiftContext(intent.id));
      const orderRecipient = this.protector.protect(
        JSON.stringify(recipient),
        orderRecipientContext(orderId),
      );
      const orderGiftMessage = this.protector.protect(giftMessage, orderGiftContext(orderId));
      const orderAddress = this.protector.protect(JSON.stringify({
        customerDetails: payload.customerDetails,
        collectedInformation: payload.collectedInformation,
      }), orderAddressContext(orderId));
      if (
        orderRecipient.keyId !== orderGiftMessage.keyId
        || orderRecipient.keyId !== orderAddress.keyId
      ) {
        throw new InvalidStripeCommerceEventError();
      }

      await this.buyerWriter(transaction).create({ buyerId, purchaseIntentId: intent.id, occurredAt: event.occurredAt });
      await transaction`
        INSERT INTO bloombox.recipients (id, created_at)
        VALUES (${recipientId}, ${event.occurredAt})
      `;
      await transaction`
        INSERT INTO bloombox.orders (
          id, display_id, buyer_id, purchase_intent_id, status, commerce_provider,
          external_order_id, currency, subtotal_minor, tax_minor, included_tax_minor,
          shipping_minor, discount_minor, total_minor, confirmed_at, created_at, updated_at
        ) VALUES (
          ${orderId}, ${orderDisplayId(event.occurredAt, orderId)}, ${buyerId}, ${intent.id},
          'CONFIRMED', 'STRIPE', ${payload.id}, ${intent.currency}, ${itemSubtotal},
          ${tax}, ${includedTax}, ${shipping}, ${discount}, ${amountTotal},
          ${event.occurredAt}, ${event.occurredAt}, ${event.occurredAt}
        )
      `;
      await transaction`
        INSERT INTO bloombox.order_items (
          id, order_id, catalog_product_id, external_product_id, product_name_snapshot, quantity,
          unit_amount_minor, tax_minor, discount_minor, line_total_minor, currency, position
        ) VALUES (
          ${this.createId()}, ${orderId}, ${intent.catalog_product_id},
          ${intent.external_product_id},
          ${intent.product_name_snapshot}, ${intent.quantity},
          ${toSafeInteger(intent.unit_amount_minor)}, 0, ${loyaltyDiscount}, ${netSubtotal}, ${intent.currency}, 0
        )
      `;
      await transaction`
        INSERT INTO bloombox.order_gift_snapshots (
          order_id, recipient_id, delivery_date, pii_key_id, recipient_ciphertext,
          address_ciphertext, gift_message_ciphertext
        ) VALUES (
          ${orderId}, ${recipientId}, ${intent.delivery_date}, ${orderRecipient.keyId},
          ${orderRecipient.ciphertext}, ${orderAddress.ciphertext}, ${orderGiftMessage.ciphertext}
        )
      `;
      await transaction`
        INSERT INTO bloombox.order_status_transitions (
          id, order_id, from_status, to_status, reason_code, actor_type,
          actor_reference, idempotency_key, occurred_at
        ) VALUES (
          ${this.createId()}, ${orderId}, NULL, 'CONFIRMED', 'PROVIDER_PAYMENT_CONFIRMED',
          'PROVIDER', ${event.providerAccountId}, ${event.externalEventId}, ${event.occurredAt}
        )
      `;
      await transaction`
        INSERT INTO bloombox.payments (
          id, order_id, commerce_provider, external_payment_id, status,
          amount_requested_minor, amount_authorized_minor, amount_captured_minor,
          amount_refunded_minor, currency, created_at, updated_at
        ) VALUES (
          ${paymentId}, ${orderId}, 'STRIPE', ${paymentIntentId}, 'CAPTURED',
          ${amountTotal}, ${amountTotal}, ${amountTotal}, 0,
          ${intent.currency}, ${event.occurredAt}, ${event.occurredAt}
        )
      `;
      await transaction`
        INSERT INTO bloombox.payment_attempts (
          id, payment_id, external_attempt_id, status, requested_amount_minor,
          authorized_amount_minor, captured_amount_minor, occurred_at
        ) VALUES (
          ${this.createId()}, ${paymentId}, ${paymentIntentId}, 'CAPTURED',
          ${amountTotal}, ${amountTotal}, ${amountTotal}, ${event.occurredAt}
        )
      `;
      await transaction`
        INSERT INTO bloombox.payment_status_transitions (
          id, payment_id, from_status, to_status, provider_event_id, reason_code, occurred_at
        ) VALUES (
          ${this.createId()}, ${paymentId}, NULL, 'CAPTURED', ${event.externalEventId},
          'PROVIDER_CAPTURE_CONFIRMED', ${event.occurredAt}
        )
      `;
      await transaction`
        INSERT INTO bloombox.fulfillments (id, order_id, status, created_at, updated_at)
        VALUES (${fulfillmentId}, ${orderId}, 'UNFULFILLED', ${event.occurredAt}, ${event.occurredAt})
      `;
      await transaction`
        INSERT INTO bloombox.fulfillment_status_transitions (
          id, fulfillment_id, from_status, to_status, reason_code, idempotency_key, occurred_at
        ) VALUES (
          ${this.createId()}, ${fulfillmentId}, NULL, 'UNFULFILLED', 'ORDER_CONFIRMED',
          ${event.externalEventId}, ${event.occurredAt}
        )
      `;
      await this.recordCaptureLedger(
        transaction,
        orderId,
        paymentId,
        paymentIntentId,
        amountTotal,
        intent.currency,
        event.occurredAt,
      );
      if (intent.catalog_product_id.startsWith("native_")) {
        if (!this.inventory) throw new InventoryUnavailableError();
        await this.inventory(transaction).commit(intent.id, event.occurredAt);
      }
      await transaction`
        UPDATE bloombox.purchase_intents
        SET status = 'CONVERTED', version = version + 1, updated_at = ${event.occurredAt}
        WHERE id = ${intent.id}
      `;
      await transaction`
        INSERT INTO bloombox.outbox_events (
          id, aggregate_type, aggregate_id, event_type, event_version,
          payload, occurred_at, available_at
        ) VALUES (
          ${this.createId()}, 'Order', ${orderId}, 'order.confirmed', 1,
          ${transaction.json({ orderId, purchaseIntentId: intent.id, provider: "STRIPE" })},
          ${event.occurredAt}, ${event.occurredAt}
        )
      `;
      await insertAudit(transaction, this.createId(), event, "order.confirmed", orderId);
    });
  }

  private async transitionPurchaseIntent(
    event: VerifiedProviderEvent,
    purchaseIntentId: string,
    status: "EXPIRED" | "ABANDONED",
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const rows = await transaction`SELECT intent.status, intent.commerce_provider, intent.external_checkout_id, item.catalog_product_id
        FROM bloombox.purchase_intents intent JOIN bloombox.purchase_intent_items item ON item.purchase_intent_id = intent.id AND item.position = 0
        WHERE intent.id = ${purchaseIntentId} FOR UPDATE OF intent`;
      const row = rows[0];
      if (!row) throw new StripeCommerceEventDependencyError();
      if (row.commerce_provider !== "STRIPE" || row.external_checkout_id !== event.externalObjectId) throw new InvalidStripeCommerceEventError();
      if (row.status === status || row.status === "CONVERTED") return;
      if (row.status !== "CHECKOUT_CREATED") throw new InvalidStripeCommerceEventError();
      if (String(row.catalog_product_id).startsWith("native_")) {
        if (!this.inventory) throw new InventoryUnavailableError();
        await this.inventory(transaction).release(purchaseIntentId, status === "EXPIRED" ? "CHECKOUT_EXPIRED" : "PAYMENT_FAILED", event.occurredAt);
      }
      await transaction`UPDATE bloombox.purchase_intents SET status = ${status}, version = version + 1, updated_at = ${event.occurredAt}
        WHERE id = ${purchaseIntentId}`;
      await insertAudit(transaction, this.createId(), event, `checkout.${status.toLowerCase()}`, purchaseIntentId);
    });
  }

  private async processRefundEvent(event: VerifiedProviderEvent): Promise<void> {
    const payload = refundPayloadSchema.safeParse(event.payload);
    if (!payload.success) throw new InvalidStripeCommerceEventError();
    const refundStatus = mapRefundStatus(payload.data.status, event.eventType);

    await this.sql.begin(async (transaction) => {
      const payments = await transaction`
        SELECT id, order_id, status, amount_captured_minor, amount_refunded_minor, currency
        FROM bloombox.payments
        WHERE commerce_provider = 'STRIPE' AND external_payment_id = ${payload.data.paymentIntentId}
        FOR UPDATE
      `;
      const payment = payments[0];
      if (!payment) throw new StripeCommerceEventDependencyError();
      if (payment.currency.toLowerCase() !== payload.data.currency.toLowerCase()) {
        throw new InvalidStripeCommerceEventError();
      }
      const captured = toSafeInteger(payment.amount_captured_minor);
      if (payload.data.amount > captured) throw new InvalidStripeCommerceEventError();

      const existingRefunds = await transaction`
        SELECT payment_id, status, amount_minor, currency, updated_at
        FROM bloombox.refunds
        WHERE commerce_provider = 'STRIPE' AND external_refund_id = ${payload.data.id}
        FOR UPDATE
      `;
      const existingRefund = existingRefunds[0];
      let effectiveRefundStatus = refundStatus;
      if (existingRefund) {
        if (
          existingRefund.payment_id !== payment.id
          || toSafeInteger(existingRefund.amount_minor) !== payload.data.amount
          || existingRefund.currency !== payment.currency
        ) {
          throw new InvalidStripeCommerceEventError();
        }
        effectiveRefundStatus = resolveProviderState(
          existingRefund.status,
          new Date(existingRefund.updated_at),
          refundStatus,
          event.occurredAt,
          isTerminalRefundStatus,
        ) as typeof refundStatus;
        if (effectiveRefundStatus !== existingRefund.status) {
          await transaction`
            UPDATE bloombox.refunds
            SET status = ${effectiveRefundStatus},
                reason_code = ${payload.data.reason ?? "UNSPECIFIED"},
                updated_at = ${event.occurredAt}
            WHERE commerce_provider = 'STRIPE' AND external_refund_id = ${payload.data.id}
          `;
        }
      } else {
        await transaction`
          INSERT INTO bloombox.refunds (
            id, payment_id, commerce_provider, external_refund_id, status,
            amount_minor, currency, reason_code, created_at, updated_at
          ) VALUES (
            ${this.createId()}, ${payment.id}, 'STRIPE', ${payload.data.id}, ${refundStatus},
            ${payload.data.amount}, ${payment.currency}, ${payload.data.reason ?? "UNSPECIFIED"},
            ${event.occurredAt}, ${event.occurredAt}
          )
        `;
      }
      const totals = await transaction`
        SELECT
          COALESCE(SUM(amount_minor) FILTER (WHERE status = 'SUCCEEDED'), 0) AS refunded,
          EXISTS (
            SELECT 1 FROM bloombox.disputes
            WHERE payment_id = ${payment.id} AND status IN ('NEEDS_RESPONSE', 'UNDER_REVIEW')
          ) AS has_open_dispute
        FROM bloombox.refunds
        WHERE payment_id = ${payment.id}
      `;
      const refunded = toSafeInteger(totals[0].refunded);
      if (refunded > captured) throw new InvalidStripeCommerceEventError();
      const paymentStatus = totals[0].has_open_dispute
        ? "DISPUTED"
        : refunded === 0
          ? "CAPTURED"
          : refunded === captured ? "REFUNDED" : "PARTIALLY_REFUNDED";
      if (payment.status !== paymentStatus || toSafeInteger(payment.amount_refunded_minor ?? 0) !== refunded) {
        await transaction`
          UPDATE bloombox.payments
          SET status = ${paymentStatus}, amount_refunded_minor = ${refunded},
              version = version + 1, updated_at = ${event.occurredAt}
          WHERE id = ${payment.id}
        `;
      }
      if (payment.status !== paymentStatus) {
        await transaction`
          INSERT INTO bloombox.payment_status_transitions (
            id, payment_id, from_status, to_status, provider_event_id, reason_code, occurred_at
          ) VALUES (
            ${this.createId()}, ${payment.id}, ${payment.status}, ${paymentStatus},
            ${event.externalEventId}, 'PROVIDER_REFUND_UPDATED', ${event.occurredAt}
          ) ON CONFLICT DO NOTHING
        `;
      }
      if (effectiveRefundStatus === "SUCCEEDED") {
        await this.recordRefundLedger(
          transaction,
          payment.order_id,
          payment.id,
          payload.data.id,
          toSafeInteger(existingRefund?.amount_minor ?? payload.data.amount),
          payment.currency,
          event.occurredAt,
        );
      }
      await insertAudit(transaction, this.createId(), event, "payment.refund_updated", payment.id);
    });
  }

  private async processDisputeEvent(event: VerifiedProviderEvent): Promise<void> {
    const payload = disputePayloadSchema.safeParse(event.payload);
    if (!payload.success) throw new InvalidStripeCommerceEventError();
    const disputeStatus = mapDisputeStatus(payload.data.status);

    await this.sql.begin(async (transaction) => {
      const payments = await transaction`
        SELECT id, status, amount_captured_minor, amount_refunded_minor, currency
        FROM bloombox.payments
        WHERE commerce_provider = 'STRIPE' AND external_payment_id = ${payload.data.paymentIntentId}
        FOR UPDATE
      `;
      const payment = payments[0];
      if (!payment) throw new StripeCommerceEventDependencyError();
      if (payment.currency.toLowerCase() !== payload.data.currency.toLowerCase()) {
        throw new InvalidStripeCommerceEventError();
      }
      if (payload.data.amount > toSafeInteger(payment.amount_captured_minor)) {
        throw new InvalidStripeCommerceEventError();
      }
      const existingDisputes = await transaction`
        SELECT payment_id, status, amount_minor, currency, updated_at
        FROM bloombox.disputes
        WHERE commerce_provider = 'STRIPE' AND external_dispute_id = ${payload.data.id}
        FOR UPDATE
      `;
      const existingDispute = existingDisputes[0];
      if (existingDispute) {
        if (
          existingDispute.payment_id !== payment.id
          || toSafeInteger(existingDispute.amount_minor) !== payload.data.amount
          || existingDispute.currency !== payment.currency
        ) {
          throw new InvalidStripeCommerceEventError();
        }
        const effectiveDisputeStatus = resolveProviderState(
          existingDispute.status,
          new Date(existingDispute.updated_at),
          disputeStatus,
          event.occurredAt,
          isTerminalDisputeStatus,
        );
        if (effectiveDisputeStatus !== existingDispute.status) {
          await transaction`
            UPDATE bloombox.disputes
            SET status = ${effectiveDisputeStatus}, reason_code = ${payload.data.reason},
                updated_at = ${event.occurredAt}
            WHERE commerce_provider = 'STRIPE' AND external_dispute_id = ${payload.data.id}
          `;
        }
      } else {
        await transaction`
          INSERT INTO bloombox.disputes (
            id, payment_id, commerce_provider, external_dispute_id, status,
            amount_minor, currency, reason_code, created_at, updated_at
          ) VALUES (
            ${this.createId()}, ${payment.id}, 'STRIPE', ${payload.data.id}, ${disputeStatus},
            ${payload.data.amount}, ${payment.currency}, ${payload.data.reason},
            ${event.occurredAt}, ${event.occurredAt}
          )
        `;
      }
      const openDisputes = await transaction`
        SELECT EXISTS (
          SELECT 1 FROM bloombox.disputes
          WHERE payment_id = ${payment.id} AND status IN ('NEEDS_RESPONSE', 'UNDER_REVIEW')
        ) AS has_open_dispute
      `;
      const refunded = toSafeInteger(payment.amount_refunded_minor);
      const captured = toSafeInteger(payment.amount_captured_minor);
      const nextPaymentStatus = openDisputes[0].has_open_dispute
        ? "DISPUTED"
        : refunded === 0 ? "CAPTURED" : refunded === captured ? "REFUNDED" : "PARTIALLY_REFUNDED";
      if (payment.status !== nextPaymentStatus) {
        await transaction`
          UPDATE bloombox.payments
          SET status = ${nextPaymentStatus}, version = version + 1, updated_at = ${event.occurredAt}
          WHERE id = ${payment.id}
        `;
        await transaction`
          INSERT INTO bloombox.payment_status_transitions (
            id, payment_id, from_status, to_status, provider_event_id, reason_code, occurred_at
          ) VALUES (
            ${this.createId()}, ${payment.id}, ${payment.status}, ${nextPaymentStatus},
            ${event.externalEventId}, 'PROVIDER_DISPUTE_UPDATED', ${event.occurredAt}
          ) ON CONFLICT DO NOTHING
        `;
      }
      await insertAudit(transaction, this.createId(), event, "payment.dispute_updated", payment.id);
    });
  }

  private async recordCaptureLedger(
    transaction: DatabaseTransaction,
    orderId: string,
    paymentId: string,
    externalReference: string,
    amount: number,
    currency: string,
    occurredAt: Date,
  ): Promise<void> {
    const transactionId = this.createId();
    await transaction`
      INSERT INTO bloombox.financial_transactions (
        id, order_id, payment_id, transaction_type, currency, external_reference, occurred_at
      ) VALUES (
        ${transactionId}, ${orderId}, ${paymentId}, 'CAPTURE', ${currency},
        ${externalReference}, ${occurredAt}
      )
    `;
    await transaction`
      INSERT INTO bloombox.ledger_entries (
        id, financial_transaction_id, account_code, signed_amount_minor, currency
      ) VALUES
        (${this.createId()}, ${transactionId}, 'STRIPE_CLEARING', ${amount}, ${currency}),
        (${this.createId()}, ${transactionId}, 'ORDER_REVENUE', ${-amount}, ${currency})
    `;
  }

  private async recordRefundLedger(
    transaction: DatabaseTransaction,
    orderId: string,
    paymentId: string,
    externalReference: string,
    amount: number,
    currency: string,
    occurredAt: Date,
  ): Promise<void> {
    const transactionId = this.createId();
    const inserted = await transaction`
      INSERT INTO bloombox.financial_transactions (
        id, order_id, payment_id, transaction_type, currency, external_reference, occurred_at
      ) VALUES (
        ${transactionId}, ${orderId}, ${paymentId}, 'REFUND', ${currency},
        ${externalReference}, ${occurredAt}
      ) ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) return;
    await transaction`
      INSERT INTO bloombox.ledger_entries (
        id, financial_transaction_id, account_code, signed_amount_minor, currency
      ) VALUES
        (${this.createId()}, ${transactionId}, 'ORDER_REVENUE', ${amount}, ${currency}),
        (${this.createId()}, ${transactionId}, 'STRIPE_CLEARING', ${-amount}, ${currency})
    `;
  }

  private async recordAudit(event: VerifiedProviderEvent, action: string): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await insertAudit(
        transaction,
        this.createId(),
        event,
        action,
        event.externalObjectId ?? null,
      );
    });
  }
}

async function insertAudit(
  transaction: DatabaseTransaction,
  id: string,
  event: VerifiedProviderEvent,
  action: string,
  resourceId: string | null,
): Promise<void> {
  await transaction`
    INSERT INTO bloombox.audit_logs (
      id, actor_type, actor_reference, action, resource_type, resource_id,
      safe_metadata, occurred_at, idempotency_key
    ) VALUES (
      ${id}, 'PROVIDER', ${event.providerAccountId}, ${action}, 'CommerceEvent',
      ${isUuid(resourceId) ? resourceId : null},
      ${transaction.json({ eventId: event.externalEventId, eventType: event.eventType })},
      ${event.occurredAt}, ${`${event.externalEventId}:${action}`}
    ) ON CONFLICT DO NOTHING
  `;
}

function mapRefundStatus(status: string | null, eventType: string) {
  if (eventType === "refund.failed" || status === "failed") return "FAILED" as const;
  if (status === "succeeded") return "SUCCEEDED" as const;
  if (status === "canceled") return "CANCELLED" as const;
  return "PROCESSING" as const;
}

function mapDisputeStatus(status: string) {
  if (["won", "warning_closed"].includes(status)) return "WON" as const;
  if (status === "lost") return "LOST" as const;
  if (status === "closed") return "CLOSED" as const;
  if (["under_review", "warning_under_review"].includes(status)) return "UNDER_REVIEW" as const;
  return "NEEDS_RESPONSE" as const;
}

function isTerminalRefundStatus(status: string): boolean {
  return ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status);
}

function isTerminalDisputeStatus(status: string): boolean {
  return ["WON", "LOST", "CLOSED"].includes(status);
}

function resolveProviderState(
  currentStatus: string,
  currentOccurredAt: Date,
  incomingStatus: string,
  incomingOccurredAt: Date,
  isTerminal: (status: string) => boolean,
): string {
  if (incomingStatus === currentStatus) return currentStatus;
  if (incomingOccurredAt < currentOccurredAt) return currentStatus;
  if (incomingOccurredAt.getTime() === currentOccurredAt.getTime()) {
    return !isTerminal(currentStatus) && isTerminal(incomingStatus)
      ? incomingStatus
      : currentStatus;
  }
  if (isTerminal(currentStatus)) throw new InvalidStripeCommerceEventError();
  return incomingStatus;
}

function purchaseIntentRecipientContext(id: string): string {
  return `purchase-intent:${id}:recipient:v1`;
}

function purchaseIntentGiftContext(id: string): string {
  return `purchase-intent:${id}:gift-message:v1`;
}

function orderRecipientContext(id: string): string {
  return `order:${id}:recipient:v1`;
}

function orderGiftContext(id: string): string {
  return `order:${id}:gift-message:v1`;
}

function orderAddressContext(id: string): string {
  return `order:${id}:address:v1`;
}

function orderDisplayId(occurredAt: Date, id: string): string {
  const date = new Intl.DateTimeFormat("ja-JP", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(occurredAt).replaceAll("/", "");
  return `BBO-${date}-${id.slice(0, 4).toUpperCase()}`;
}

function parseJson<T>(value: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    throw new InvalidStripeCommerceEventError();
  }
}

function integerValueSchema() {
  return z.union([z.string(), z.number(), z.bigint()]);
}

function toSafeInteger(value: string | number | bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new InvalidStripeCommerceEventError();
  return number;
}

function isUuid(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
