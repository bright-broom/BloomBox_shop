import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { StripeWebhookVerifier } from "../src/modules/payment/infrastructure/stripe-webhook-verifier.ts";
import { loadStripeConfig } from "../src/shared/infrastructure/config/stripe-config.ts";
import { API_VERSION, PROBE_MARKER, loadProbeCases, verifyStripeTestMode } from "./verify-stripe-test-mode.mjs";

const environment = {
  STRIPE_MODE: "test", STRIPE_CHECKOUT_SECRET_KEY: "rk_test_checkout_fixture", STRIPE_RECONCILIATION_SECRET_KEY: "rk_test_events_fixture",
  STRIPE_READINESS_SECRET_KEY: "rk_test_readiness_fixture", STRIPE_WEBHOOK_SECRET: "whsec_test_fixture_only",
  BLOOMBOX_PUBLIC_ORIGIN: "https://test.example.com", STRIPE_ACCOUNT_ID: "acct_fixture", STRIPE_SHIPPING_RATE_ID: "shr_fixture",
  STRIPE_AUTOMATIC_TAX_ENABLED: "true", STRIPE_TAX_BEHAVIOR: "inclusive", STRIPE_TERMS_ACCEPTANCE: "required",
};
const events = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired",
  "payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled", "refund.created", "refund.updated", "refund.failed", "charge.dispute.created", "charge.dispute.closed"];
function fixture() {
  const stored = new Map();
  const sessions = {
    create: vi.fn(async (request) => {
      const id = `cs_test_${stored.size}`;
      const session = { id, client_reference_id: request.client_reference_id, livemode: false, status: "open", payment_status: "unpaid", payment_intent: null,
        url: `https://checkout.stripe.com/c/pay/${id}`, metadata: request.metadata,
        line_items: { data: [{ quantity: 1, price: request.line_items[0].price_data }], has_more: false },
        shipping_options: [{ shipping_rate: { livemode: false, ...request.shipping_options[0].shipping_rate_data } }] };
      stored.set(id, session); return session;
    }),
    retrieve: vi.fn(async (id) => stored.get(id)),
    expire: vi.fn(async (id) => { stored.get(id).status = "expired"; return stored.get(id); }),
  };
  const clients = {
    checkout: { checkout: { sessions } }, reconciliation: { events: { list: vi.fn(async () => []) } },
    readiness: {
      accounts: { retrieveCurrent: vi.fn(async () => ({ id: "acct_fixture", business_profile: { terms_of_service_url: "https://test.example.com/terms" } })) },
      shippingRates: { retrieve: vi.fn(async () => ({ active: true, livemode: false, type: "fixed_amount", fixed_amount: { currency: "jpy" }, tax_behavior: "inclusive" })) },
      tax: { settings: { retrieve: vi.fn(async () => ({ livemode: false, status: "active" })) } },
      webhookEndpoints: { list: () => [{ url: "https://test.example.com/api/webhooks/stripe", status: "enabled", livemode: false, api_version: API_VERSION, enabled_events: events }] },
    },
  };
  return { clients, sessions, stored, factory: vi.fn(() => clients) };
}

describe("Stripe shipping connection probe", () => {
  it("checks persisted M/L rates, expires both Sessions before success, and makes no payment claim", async () => {
    const f = fixture(); const result = await verifyStripeTestMode(environment, f.factory);
    expect(result).toMatchObject({ status: "connection_verified", paymentVerification: "not_performed", finalTaxAndTotalVerification: "not_performed" });
    expect(result.probes.map(({ size, unitAmount, shippingAmount, expectedTotal, cleanup }) => ({ size, unitAmount, shippingAmount, expectedTotal, cleanup }))).toEqual([
      { size: "M", unitAmount: 4000, shippingAmount: 1000, expectedTotal: 5000, cleanup: "expired" },
      { size: "L", unitAmount: 8000, shippingAmount: 0, expectedTotal: 8000, cleanup: "expired" },
    ]);
    expect(f.sessions.expire).toHaveBeenCalledTimes(2);
    for (const [request, options] of f.sessions.create.mock.calls) {
      expect(request.client_reference_id).toMatch(/^readiness_/);
      expect(request.metadata).toEqual({ readiness_probe: PROBE_MARKER });
      expect(request.shipping_options[0]).not.toHaveProperty("shipping_rate");
      expect(request).not.toHaveProperty("customer"); expect(request).not.toHaveProperty("payment_method");
      expect(options.idempotencyKey).toContain(request.client_reference_id);
    }
    expect(JSON.stringify(result)).not.toContain("https://checkout.stripe.com");
    const config = loadStripeConfig(environment);
    expect(API_VERSION).toBe(config.apiVersion);
    for (const session of f.stored.values()) {
      const raw = JSON.stringify({ id: "evt_probe", type: "checkout.session.expired", account: environment.STRIPE_ACCOUNT_ID,
        api_version: API_VERSION, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: { ...session, payment_intent: null } } });
      const header = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret: environment.STRIPE_WEBHOOK_SECRET });
      expect(new StripeWebhookVerifier(config).verify(raw, header)).toBeNull();
    }
  });
  it.each([
    { STRIPE_MODE: "live" }, { STRIPE_CHECKOUT_SECRET_KEY: "sk_live_forbidden" },
    { STRIPE_READINESS_SECRET_KEY: environment.STRIPE_CHECKOUT_SECRET_KEY }, { STRIPE_TAX_BEHAVIOR: "exclusive" },
    { STRIPE_AUTOMATIC_TAX_ENABLED: "false" }, { STRIPE_WEBHOOK_SECRET: "" }, { BLOOMBOX_PUBLIC_ORIGIN: "http://test.example.com" },
  ])("refuses unsafe configuration without initializing an API client: %j", async (change) => {
    const f = fixture(); const result = await verifyStripeTestMode({ ...environment, ...change }, f.factory);
    expect(result.status).toBe("failed"); expect(result.failure.stage).toBe("configuration"); expect(f.factory).not.toHaveBeenCalled();
  });
  it("does not create Sessions when account identity differs", async () => {
    const f = fixture(); f.clients.readiness.accounts.retrieveCurrent.mockResolvedValue({ id: "acct_other" });
    expect((await verifyStripeTestMode(environment, f.factory)).status).toBe("failed"); expect(f.sessions.create).not.toHaveBeenCalled();
  });
  it.each(["shipping", "price", "quantity", "currency", "extra_shipping", "live_shipping"])("cleans up and fails when Stripe readback changes %s", async (field) => {
    const f = fixture(); const normal = f.sessions.retrieve.getMockImplementation();
    f.sessions.retrieve.mockImplementation(async (id, options) => {
      const row = await normal(id);
      if (!options) return row;
      const changed = structuredClone(row);
      if (field === "shipping") changed.shipping_options[0].shipping_rate.fixed_amount.amount += 100;
      if (field === "price") changed.line_items.data[0].price.unit_amount += 100;
      if (field === "quantity") changed.line_items.data[0].quantity = 2;
      if (field === "currency") changed.shipping_options[0].shipping_rate.fixed_amount.currency = "usd";
      if (field === "extra_shipping") changed.shipping_options.push(changed.shipping_options[0]);
      if (field === "live_shipping") changed.shipping_options[0].shipping_rate.livemode = true;
      return changed;
    });
    const result = await verifyStripeTestMode(environment, f.factory);
    expect(result.status).toBe("failed"); expect(result.probes[0].cleanup).toBe("expired"); expect(f.sessions.create).toHaveBeenCalledOnce();
  });
  it("tries every cleanup after one expiry fails and never reports success", async () => {
    const f = fixture(); const normal = f.sessions.expire.getMockImplementation();
    f.sessions.expire.mockImplementation(async (id) => { if (id === "cs_test_0") throw new Error("secret-provider-payload"); return normal(id); });
    const result = await verifyStripeTestMode(environment, f.factory);
    expect(result.status).toBe("failed"); expect(result.probes.map((p) => p.cleanup)).toEqual(["unconfirmed", "expired"]);
    expect(f.sessions.expire).toHaveBeenCalledTimes(2); expect(JSON.stringify(result)).not.toContain("secret-provider-payload");
  });
  it("resolves an expiry timeout by reading authoritative expired state", async () => {
    const f = fixture(); f.sessions.expire.mockImplementation(async (id) => { f.stored.get(id).status = "expired"; throw new Error("timeout"); });
    expect((await verifyStripeTestMode(environment, f.factory)).status).toBe("connection_verified");
  });
  it("keeps the first probe cleanup and records unknown creation for a later timeout without leaking errors", async () => {
    const f = fixture(); const normal = f.sessions.create.getMockImplementation();
    f.sessions.create.mockImplementation(async (request) => { if (f.stored.size) throw new Error("credential-and-customer-data"); return normal(request); });
    const result = await verifyStripeTestMode(environment, f.factory);
    expect(result.status).toBe("failed"); expect(result.probes.map((p) => p.cleanup)).toEqual(["expired", "unknown"]);
    expect(result.probes[1].idempotencyKey).toBeTruthy(); expect(JSON.stringify(result)).not.toContain("credential-and-customer-data");
  });
  it("does not attempt to expire a live object even under test credentials", async () => {
    const f = fixture(); f.sessions.create.mockResolvedValue({ id: "cs_live_other", livemode: true });
    expect((await verifyStripeTestMode(environment, f.factory)).status).toBe("failed"); expect(f.sessions.expire).not.toHaveBeenCalled();
  });
  it("rejects unconfigured or ambiguous fixtures instead of silently treating them as free", () => {
    expect(() => loadProbeCases([])).toThrow();
    expect(() => loadProbeCases([{ priceAmount: 4000, previewOffer: { family: "bloom-box", size: "M" } }])).toThrow();
  });
});
