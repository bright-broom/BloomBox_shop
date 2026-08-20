import Stripe from "stripe";
import { z } from "zod";
import type {
  ProviderWebhookVerifier,
  VerifiedProviderEvent,
} from "../application/receive-provider-webhook";
import { InvalidProviderWebhookError } from "../application/receive-provider-webhook";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";

export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

const eventSchema = z.object({
  id: z.string().startsWith("evt_"),
  type: z.string().min(1),
  account: z.string().startsWith("acct_").optional(),
  api_version: z.string().nullable(),
  created: z.number().int().nonnegative(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const addressSchema = z.object({
  city: z.string().max(200).nullable().optional(),
  country: z.string().length(2).nullable().optional(),
  line1: z.string().max(200).nullable().optional(),
  line2: z.string().max(200).nullable().optional(),
  postal_code: z.string().max(32).nullable().optional(),
  state: z.string().max(200).nullable().optional(),
});

const customerDetailsSchema = z.object({
  email: z.string().email().max(254).nullable().optional(),
  name: z.string().max(200).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
});

const collectedInformationSchema = z.object({
  shipping_details: z.object({
    name: z.string().min(1).max(200),
    address: addressSchema,
  }).nullable().optional(),
});

const checkoutSessionSchema = z.object({
  id: z.string().startsWith("cs_"),
  client_reference_id: z.string().uuid(),
  payment_intent: expandableIdSchema("pi_").nullable(),
  payment_status: z.string(),
  status: z.string().nullable(),
  amount_total: z.number().int().nonnegative().nullable(),
  amount_subtotal: z.number().int().nonnegative().nullable(),
  currency: z.string().nullable(),
  customer: expandableIdSchema("cus_").nullable(),
  customer_details: customerDetailsSchema.nullable(),
  collected_information: collectedInformationSchema.nullable(),
  total_details: z.object({
    amount_discount: z.number().int().nonnegative(),
    amount_shipping: z.number().int().nonnegative().nullable(),
    amount_tax: z.number().int().nonnegative(),
  }).nullable(),
  metadata: z.record(z.string(), z.string()),
});

const paymentIntentSchema = z.object({
  id: z.string().startsWith("pi_"),
  status: z.string(),
  amount: z.number().int().nonnegative(),
  amount_received: z.number().int().nonnegative(),
  currency: z.string(),
  customer: expandableIdSchema("cus_").nullable(),
  metadata: z.record(z.string(), z.string()),
});

const disputeSchema = z.object({
  id: z.string().startsWith("dp_"),
  payment_intent: expandableIdSchema("pi_").nullable(),
  amount: z.number().int().positive(),
  currency: z.string(),
  reason: z.string(),
  status: z.string(),
});

const refundSchema = z.object({
  id: z.string().startsWith("re_"),
  payment_intent: expandableIdSchema("pi_").nullable(),
  amount: z.number().int().positive(),
  currency: z.string(),
  status: z.string().nullable(),
  reason: z.string().nullable(),
  failure_reason: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()),
});

const CHECKOUT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
const PAYMENT_INTENT_EVENTS = new Set([
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);
const REFUND_EVENTS = new Set(["refund.created", "refund.updated", "refund.failed"]);
const DISPUTE_EVENTS = new Set(["charge.dispute.created", "charge.dispute.closed"]);

export class StripeWebhookVerifier implements ProviderWebhookVerifier {
  private readonly stripe: Stripe;

  constructor(private readonly config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: config.apiVersion,
      maxNetworkRetries: 0,
      telemetry: false,
    });
  }

  verify(rawBody: string, signature: string): VerifiedProviderEvent | null {
    let untrustedEvent: Stripe.Event;
    try {
      untrustedEvent = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.webhookSecret,
        STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      );
    } catch {
      throw new InvalidProviderWebhookError();
    }

    return this.mapTrustedEvent(untrustedEvent);
  }

  mapTrustedEvent(untrustedEvent: unknown): VerifiedProviderEvent | null {
    const event = eventSchema.safeParse(untrustedEvent);
    if (!event.success) throw new InvalidProviderWebhookError();
    if (event.data.account && event.data.account !== this.config.accountId) {
      throw new InvalidProviderWebhookError();
    }

    const mapped = mapEventPayload(event.data.type, event.data.data.object);
    if (!mapped) return null;
    return {
      provider: "STRIPE",
      providerAccountId: event.data.account ?? this.config.accountId,
      externalEventId: event.data.id,
      eventType: event.data.type,
      externalObjectId: mapped.externalObjectId,
      apiVersion: event.data.api_version ?? this.config.apiVersion,
      occurredAt: new Date(event.data.created * 1000),
      payload: mapped.payload,
    };
  }
}

function mapEventPayload(
  eventType: string,
  object: Record<string, unknown>,
): { externalObjectId: string; payload: Readonly<Record<string, unknown>> } | null {
  if (CHECKOUT_EVENTS.has(eventType)) {
    const session = checkoutSessionSchema.safeParse(object);
    if (!session.success) throw new InvalidProviderWebhookError();
    return {
      externalObjectId: session.data.id,
      payload: {
        objectType: "checkout_session",
        id: session.data.id,
        purchaseIntentId: session.data.client_reference_id,
        paymentIntentId: expandableId(session.data.payment_intent),
        paymentStatus: session.data.payment_status,
        checkoutStatus: session.data.status,
        amountTotal: session.data.amount_total,
        amountSubtotal: session.data.amount_subtotal,
        currency: session.data.currency,
        totalDetails: session.data.total_details,
        customerId: expandableId(session.data.customer),
        customerDetails: session.data.customer_details,
        collectedInformation: session.data.collected_information,
      },
    };
  }
  if (PAYMENT_INTENT_EVENTS.has(eventType)) {
    const payment = paymentIntentSchema.safeParse(object);
    if (!payment.success) throw new InvalidProviderWebhookError();
    return {
      externalObjectId: payment.data.id,
      payload: {
        objectType: "payment_intent",
        id: payment.data.id,
        purchaseIntentId: payment.data.metadata.purchase_intent_id ?? null,
        status: payment.data.status,
        amount: payment.data.amount,
        amountReceived: payment.data.amount_received,
        currency: payment.data.currency,
        customerId: expandableId(payment.data.customer),
      },
    };
  }
  if (REFUND_EVENTS.has(eventType)) {
    const refund = refundSchema.safeParse(object);
    if (!refund.success) throw new InvalidProviderWebhookError();
    return {
      externalObjectId: refund.data.id,
      payload: {
        objectType: "refund",
        id: refund.data.id,
        purchaseIntentId: refund.data.metadata.purchase_intent_id ?? null,
        paymentIntentId: expandableId(refund.data.payment_intent),
        amount: refund.data.amount,
        currency: refund.data.currency,
        status: refund.data.status,
        reason: refund.data.reason,
        failureReason: refund.data.failure_reason ?? null,
      },
    };
  }
  if (DISPUTE_EVENTS.has(eventType)) {
    const dispute = disputeSchema.safeParse(object);
    if (!dispute.success) throw new InvalidProviderWebhookError();
    return {
      externalObjectId: dispute.data.id,
      payload: {
        objectType: "dispute",
        id: dispute.data.id,
        paymentIntentId: expandableId(dispute.data.payment_intent),
        amount: dispute.data.amount,
        currency: dispute.data.currency,
        reason: dispute.data.reason,
        status: dispute.data.status,
      },
    };
  }
  return null;
}

function expandableIdSchema(prefix: string) {
  return z.union([
    z.string().startsWith(prefix),
    z.object({ id: z.string().startsWith(prefix) }),
  ]);
}

function expandableId(value: string | { id: string } | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}
