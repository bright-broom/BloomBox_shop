import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_VERSION, createClients, verifyStripeTestMode } from "./verify-stripe-test-mode.mjs";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("stripe", async (importOriginal) => {
  const { default: RealStripe } = await importOriginal();
  return { default: class extends RealStripe {
    constructor(key, options) {
      super(key, { ...options, httpClient: RealStripe.createFetchHttpClient(transport.fetch) });
    }
  } };
});

const roles = ["checkout", "reconciliation", "readiness"];
const environment = {
  STRIPE_MODE: "test", STRIPE_CHECKOUT_SECRET_KEY: "rk_test_checkout_transport", STRIPE_RECONCILIATION_SECRET_KEY: "rk_test_reconciliation_transport",
  STRIPE_READINESS_SECRET_KEY: "rk_test_readiness_transport", STRIPE_WEBHOOK_SECRET: "whsec_transport_fixture",
  BLOOMBOX_PUBLIC_ORIGIN: "https://test.example.com", STRIPE_ACCOUNT_ID: "acct_expected", STRIPE_SHIPPING_RATE_ID: "shr_fixture",
  STRIPE_AUTOMATIC_TAX_ENABLED: "true", STRIPE_TAX_BEHAVIOR: "inclusive", STRIPE_TERMS_ACCEPTANCE: "required",
};

describe("readiness account binding through the real Stripe SDK", () => {
  beforeEach(() => { transport.fetch.mockReset(); });

  it.each([...roles, "none"])("uses each key's own account without account override (mismatch: %s)", async (mismatch) => {
    transport.fetch.mockImplementation(async (url, options) => {
      const authorization = new Headers(options.headers).get("authorization");
      if (new URL(url).pathname === "/v1/account") {
        return Response.json({ id: authorization === `Bearer rk_test_${mismatch}_transport` ? "acct_wrong" : "acct_expected" });
      }
      // Stop at the first contract read: all writes must come after identity verification.
      return Response.json({ error: { type: "invalid_request_error", message: "private-provider-detail" } }, { status: 403 });
    });

    const result = await verifyStripeTestMode(environment, createClients);
    const count = mismatch === "none" ? 3 : roles.indexOf(mismatch) + 1;
    expect(transport.fetch).toHaveBeenCalledTimes(count + (mismatch === "none" ? 1 : 0));
    for (let index = 0; index < count; index++) {
      const [url, options] = transport.fetch.mock.calls[index];
      expect(String(url)).toBe("https://api.stripe.com/v1/account");
      const headers = new Headers(options.headers);
      expect(headers.get("authorization")).toBe(`Bearer rk_test_${roles[index]}_transport`);
      expect(headers.get("stripe-version")).toBe(API_VERSION);
      expect(headers.get("stripe-account")).toBeNull();
    }
    for (const [, options] of transport.fetch.mock.calls) expect(options.method).toBe("GET");
    expect(result).toMatchObject({ status: "failed", probes: [],
      failure: { stage: mismatch === "none" ? "account_contract" : `account_identity_${mismatch}` } });
    expect(JSON.stringify(result)).not.toMatch(/rk_test_|acct_wrong|private-provider-detail/);
  });
});
