import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { StripeSdkCheckoutApi } from "@/modules/checkout/infrastructure/stripe/stripe-checkout-session-provider";
import { StripeSdkEventSource } from "./stripe-event-reconciler";
import { STRIPE_API_VERSION, type StripeConfig } from "@/shared/infrastructure/config/stripe-config";

const transport = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
vi.mock("stripe", async (importOriginal) => {
  const { default: RealStripe } = await importOriginal<typeof import("stripe")>();
  return { default: class extends RealStripe {
    constructor(key: string, options?: Stripe.StripeConfig) {
      super(key, { ...options, httpClient: RealStripe.createFetchHttpClient(transport.fetch) });
    }
  } };
});
const config: StripeConfig = {
  mode: "test", checkoutSecretKey: "rk_test_checkout_synthetic", reconciliationSecretKey: "rk_test_reconcile_synthetic",
  webhookSecret: "whsec_synthetic_example", accountId: "acct_example", shippingRateId: "shr_example",
  taxBehavior: "inclusive", automaticTaxEnabled: true, termsAcceptance: "required",
  allowedCheckoutHostnames: ["checkout.stripe.com"], publicOrigin: "https://shop.example.test", apiVersion: STRIPE_API_VERSION,
};
const session = { id: "cs_test_example", client_reference_id: "synthetic-intent", url: "https://checkout.stripe.com/c/pay/synthetic",
  expires_at: 1_800_000_000, livemode: false };
function requestHeaders(index: number) { return new Headers(transport.fetch.mock.calls[index][1]?.headers); }

describe("real Stripe SDK wire API version", () => {
  beforeEach(() => { transport.fetch.mockReset(); });
  it("pins create and retrieve requests without losing checkout idempotency", async () => {
    transport.fetch.mockImplementation(async () => Response.json(session));
    const api = new StripeSdkCheckoutApi(config);
    await api.create({ purchaseIntentId: "synthetic-intent", productId: "synthetic-product", externalProductReference: "synthetic-variant",
      productName: "Synthetic flowers", currency: "JPY", unitAmount: 4000, quantity: 1,
      expiresAt: new Date(session.expires_at * 1000), idempotencyKey: "synthetic-checkout-key" });
    await api.retrieve(session.id);
    expect(transport.fetch).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 2; index++) expect(requestHeaders(index).get("stripe-version")).toBe(STRIPE_API_VERSION);
    expect(requestHeaders(0).get("idempotency-key")).toBe("synthetic-checkout-key");
    expect(String(transport.fetch.mock.calls[0][0])).toContain("/v1/checkout/sessions");
    expect(String(transport.fetch.mock.calls[1][0])).toContain(`/v1/checkout/sessions/${session.id}`);
  });
  it("retains the pinned version on every automatically fetched event page", async () => {
    transport.fetch.mockResolvedValueOnce(Response.json({ object: "list", url: "/v1/events", data: [{ id: "evt_first" }], has_more: true }))
      .mockResolvedValueOnce(Response.json({ object: "list", url: "/v1/events", data: [{ id: "evt_second" }], has_more: false }));
    const ids: string[] = [];
    for await (const event of new StripeSdkEventSource(config).list(new Date("2026-09-01T00:00:00Z"))) ids.push(event.id);
    expect(ids).toEqual(["evt_first", "evt_second"]);
    expect(transport.fetch).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 2; index++) expect(requestHeaders(index).get("stripe-version")).toBe(STRIPE_API_VERSION);
    expect(String(transport.fetch.mock.calls[1][0])).toContain("starting_after=evt_first");
  });
});
