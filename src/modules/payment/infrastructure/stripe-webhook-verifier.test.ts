import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";
import {
  StripeWebhookVerifier,
} from "./stripe-webhook-verifier";
import { InvalidProviderWebhookError } from "../application/receive-provider-webhook";

const config: StripeConfig = {
  mode: "test",
  checkoutSecretKey: "rk_test_checkout_example",
  reconciliationSecretKey: "rk_test_reconciliation_example",
  webhookSecret: "whsec_example_only_123",
  accountId: "acct_example",
  shippingRateId: "shr_example",
  taxBehavior: "inclusive",
  automaticTaxEnabled: true,
  termsAcceptance: "required",
  allowedCheckoutHostnames: ["checkout.stripe.com"],
  publicOrigin: "http://localhost:3000",
  apiVersion: "2026-07-29.dahlia",
};
const timestamp = Math.floor(Date.now() / 1000);

describe("StripeWebhookVerifier", () => {
  it("verifies the raw body and maps a minimal encrypted-inbox payload", () => {
    const payload = JSON.stringify(event({
      type: "checkout.session.completed",
      object: {
        id: "cs_test_123",
        client_reference_id: "12345678-abcd-4000-8000-123456789012",
        payment_intent: "pi_123",
        payment_status: "paid",
        status: "complete",
        amount_total: 6600,
        amount_subtotal: 6600,
        currency: "jpy",
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
        customer: "cus_123",
        customer_details: {
          email: "buyer@example.test",
          tax_ids: [{ type: "jp_rn", value: "sensitive-tax-id" }],
        },
        collected_information: {
          shipping_details: { name: "山田 花子", address: { country: "JP" } },
        },
        metadata: { purchase_intent_id: "12345678-abcd-4000-8000-123456789012" },
      },
    }));
    const verified = new StripeWebhookVerifier(config).verify(payload, signature(payload));

    expect(verified).toMatchObject({
      provider: "STRIPE",
      providerAccountId: "acct_example",
      externalEventId: "evt_123",
      eventType: "checkout.session.completed",
      externalObjectId: "cs_test_123",
      payload: {
        purchaseIntentId: "12345678-abcd-4000-8000-123456789012",
        paymentIntentId: "pi_123",
        paymentStatus: "paid",
      },
    });
    expect(JSON.stringify(verified?.payload)).not.toContain("sensitive-tax-id");
  });

  it("rejects a modified body or a different connected account", () => {
    const payload = JSON.stringify(event({
      account: "acct_other",
      type: "payment_intent.succeeded",
      object: paymentIntent(),
    }));
    const verifier = new StripeWebhookVerifier(config);

    expect(() => verifier.verify(`${payload} `, signature(payload)))
      .toThrow(InvalidProviderWebhookError);
    expect(() => verifier.verify(payload, signature(payload)))
      .toThrow(InvalidProviderWebhookError);
  });

  it("rejects a signed event from the wrong mode or API version", () => {
    const wrongMode = JSON.stringify({
      ...event({ type: "payment_intent.succeeded", object: paymentIntent() }),
      livemode: true,
    });
    const wrongVersion = JSON.stringify({
      ...event({ type: "payment_intent.succeeded", object: paymentIntent() }),
      api_version: "2026-06-24.dahlia",
    });
    const verifier = new StripeWebhookVerifier(config);

    expect(() => verifier.verify(wrongMode, signature(wrongMode)))
      .toThrow(InvalidProviderWebhookError);
    expect(() => verifier.verify(wrongVersion, signature(wrongVersion)))
      .toThrow(InvalidProviderWebhookError);
  });

  it("acknowledges but does not retain unneeded signed event types", () => {
    const payload = JSON.stringify(event({
      type: "customer.created",
      object: { id: "cus_123" },
    }));

    expect(new StripeWebhookVerifier(config).verify(payload, signature(payload))).toBeNull();
  });
});

function event(input: {
  type: string;
  object: Record<string, unknown>;
  account?: string;
}) {
  return {
    id: "evt_123",
    object: "event",
    account: input.account,
    api_version: config.apiVersion,
    created: timestamp,
    data: { object: input.object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: input.type,
  };
}

function paymentIntent() {
  return {
    id: "pi_123",
    status: "succeeded",
    amount: 6600,
    amount_received: 6600,
    currency: "jpy",
    customer: null,
    metadata: { purchase_intent_id: "12345678-abcd-4000-8000-123456789012" },
  };
}

function signature(payload: string): string {
  const stripe = new Stripe(config.checkoutSecretKey, { apiVersion: config.apiVersion });
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: config.webhookSecret,
    timestamp,
  });
}
