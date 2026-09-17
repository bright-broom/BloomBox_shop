import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { STRIPE_API_VERSION, type StripeConfig } from "@/shared/infrastructure/config/stripe-config";
import { StripeInboxRecoverySource } from "./stripe-inbox-recovery-source";
const transport = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
vi.mock("stripe", async (original) => {
  const { default: RealStripe } = await original<typeof import("stripe")>();
  return { default: class extends RealStripe {
    constructor(key: string, options?: Stripe.StripeConfig) { super(key, { ...options, httpClient: RealStripe.createFetchHttpClient(transport.fetch) }); }
  } };
});
const config: StripeConfig = { mode: "test", checkoutSecretKey: "rk_test_checkout_synthetic", reconciliationSecretKey: "rk_test_recovery_synthetic",
  webhookSecret: "whsec_synthetic_recovery", accountId: "acct_synthetic", shippingRateId: "shr_synthetic", taxBehavior: "inclusive", automaticTaxEnabled: true,
  termsAcceptance: "required", allowedCheckoutHostnames: ["checkout.stripe.com"], publicOrigin: "https://synthetic.example.test", apiVersion: STRIPE_API_VERSION };
const event = { id: "evt_recoverySynthetic001", object: "event", type: "refund.failed", api_version: STRIPE_API_VERSION,
  created: 1800000000, livemode: false, data: { object: { id: "re_synthetic", payment_intent: "pi_synthetic", amount: 1000, currency: "jpy", status: "failed", reason: null, failure_reason: "unknown", metadata: {} } } };
describe("Stripe recovery authenticated GET", () => {
  beforeEach(() => transport.fetch.mockReset());
  it("proves account then retrieves exact event with a read-only key and pinned version", async () => {
    transport.fetch.mockResolvedValueOnce(Response.json({ id: config.accountId })).mockResolvedValueOnce(Response.json(event));
    expect(await new StripeInboxRecoverySource(config).retrieve(event.id)).toMatchObject({ externalEventId: event.id, providerAccountId: config.accountId });
    expect(String(transport.fetch.mock.calls[0][0])).toContain("/v1/account");
    expect(String(transport.fetch.mock.calls[1][0])).toContain(`/v1/events/${event.id}`);
    for (const [, init] of transport.fetch.mock.calls) {
      expect(init?.method).toBe("GET"); const headers = new Headers(init?.headers);
      expect(headers.get("stripe-version")).toBe(STRIPE_API_VERSION);
      expect(headers.get("authorization")).toBe(`Bearer ${config.reconciliationSecretKey}`);
    }
  });
  it("rejects another account before requesting an event", async () => {
    transport.fetch.mockResolvedValueOnce(Response.json({ id: "acct_other" }));
    await expect(new StripeInboxRecoverySource(config).retrieve(event.id)).rejects.toThrow("Inbox recovery source is unavailable");
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ id: "evt_wrong" }, { livemode: true }, { account: "acct_other" }, { api_version: "old" }])("rejects identity/mode/version mismatch %j", async (override) => {
    transport.fetch.mockResolvedValueOnce(Response.json({ id: config.accountId })).mockResolvedValueOnce(Response.json({ ...event, ...override }));
    await expect(new StripeInboxRecoverySource(config).retrieve(event.id)).rejects.toThrow("Inbox recovery source is unavailable");
  });
  it("reports unavailable for an event no longer retained by Stripe", async () => {
    transport.fetch.mockResolvedValueOnce(Response.json({ id: config.accountId })).mockResolvedValueOnce(Response.json({ error: { type: "invalid_request_error", message: "synthetic private message" } }, { status: 404 }));
    expect(await new StripeInboxRecoverySource(config).retrieve(event.id)).toBeNull();
  });
  it("sanitizes provider failures without retrying", async () => {
    transport.fetch.mockResolvedValueOnce(Response.json({ error: { type: "api_error", message: "synthetic private message" } }, { status: 500 }));
    await expect(new StripeInboxRecoverySource(config).retrieve(event.id)).rejects.toThrow(/^Inbox recovery source is unavailable$/);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
});
