import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import Stripe from "stripe";
import catalog from "../content/catalog.json" with { type: "json" };

export const API_VERSION = "2026-07-29.dahlia";
export const PROBE_MARKER = "bloombox-shipping-v1";
const REQUIRED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.closed",
];

class ReadinessError extends Error {}

// These are test fixtures, not a source of production catalog or fulfillment truth.
export function loadProbeCases(source = catalog) {
  assert(Array.isArray(source), "The probe catalog is invalid");
  return ["M", "L"].map((size) => {
    const matches = source.filter((p) => p.previewOffer?.family === "bloom-box" && p.previewOffer.size === size);
    assert(matches.length === 1, "Exactly one M and L fixture is required");
    const product = matches[0];
    const unitAmount = product.priceAmount;
    const shippingAmount = product.previewOffer.shippingAmount;
    assert([unitAmount, shippingAmount, unitAmount + shippingAmount].every((n) => Number.isSafeInteger(n) && n >= 0), "Probe prices must be safe nonnegative integers");
    return { size, unitAmount, shippingAmount, expectedTotal: unitAmount + shippingAmount };
  });
}

export async function verifyStripeTestMode(environment, clientsFactory, source = catalog) {
  const probes = [];
  let stage = "configuration";
  let failure;
  let checkout;
  try {
    const configuration = loadConfiguration(environment);
    const cases = loadProbeCases(source);
    const clients = clientsFactory(configuration);
    checkout = clients.checkout;
    const readiness = clients.readiness;
    stage = "account_contract";
    const account = await readiness.accounts.retrieveCurrent();
    assert(account.id === configuration.accountId, "Stripe account identity differs");
    const legacyRate = await readiness.shippingRates.retrieve(configuration.shippingRateId);
    assert(legacyRate.active && legacyRate.livemode === false && legacyRate.type === "fixed_amount"
      && legacyRate.fixed_amount?.currency === "jpy" && legacyRate.tax_behavior === configuration.taxBehavior,
    "Legacy shipping configuration differs");
    const tax = await readiness.tax.settings.retrieve();
    assert(tax.livemode === false && tax.status === "active", "Stripe test tax settings are not active");
    if (configuration.termsAcceptance === "required") assert(Boolean(account.business_profile?.terms_of_service_url), "Stripe terms URL is missing");
    const endpoints = [];
    for await (const endpoint of readiness.webhookEndpoints.list({ limit: 100 })) {
      if (endpoint.url === `${configuration.publicOrigin}/api/webhooks/stripe`) endpoints.push(endpoint);
    }
    assert(endpoints.length === 1, "Exactly one matching webhook endpoint is required");
    const endpoint = endpoints[0];
    assert(endpoint.status === "enabled" && endpoint.livemode === false && endpoint.api_version === API_VERSION, "Webhook endpoint contract differs");
    assertSameSet(endpoint.enabled_events, REQUIRED_WEBHOOK_EVENTS, "Webhook subscriptions differ");
    await clients.reconciliation.events.list({ limit: 1 });

    for (const quote of cases) {
      stage = `checkout_${quote.size}`;
      const reference = `readiness_${randomUUID()}`;
      const probe = { ...quote, reference, idempotencyKey: `stripe-readiness:${reference}`, sessionId: null, cleanup: "unknown" };
      probes.push(probe);
      const session = await checkout.checkout.sessions.create({
        mode: "payment", client_reference_id: reference, locale: "ja", submit_type: "pay", billing_address_collection: "auto",
        automatic_tax: { enabled: configuration.automaticTaxEnabled }, consent_collection: { terms_of_service: configuration.termsAcceptance },
        line_items: [{ price_data: { currency: "jpy", unit_amount: quote.unitAmount, tax_behavior: configuration.taxBehavior,
          product_data: { name: `BloomBox 送料接続確認 ${quote.size}（テスト専用）`, metadata: { readiness_probe: PROBE_MARKER } } }, quantity: 1 }],
        shipping_address_collection: { allowed_countries: ["JP"] },
        shipping_options: [{ shipping_rate_data: { type: "fixed_amount", display_name: "配送料",
          fixed_amount: { amount: quote.shippingAmount, currency: "jpy" }, tax_behavior: configuration.taxBehavior } }],
        phone_number_collection: { enabled: true }, metadata: { readiness_probe: PROBE_MARKER },
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        success_url: `${configuration.publicOrigin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${configuration.publicOrigin}/flowers?checkout=cancelled`,
      }, { idempotencyKey: probe.idempotencyKey });
      // Do not mutate an unrelated or live object even if an unexpected API response provides its ID.
      assertProbeIdentity(session, probe);
      probe.sessionId = session.id;
      assertCheckoutUrl(session.url, configuration.allowedCheckoutHostnames);
      const retrieved = await checkout.checkout.sessions.retrieve(session.id, { expand: ["shipping_options.shipping_rate", "line_items"] });
      assertProbeIdentity(retrieved, probe);
      assert(retrieved.status === "open" && retrieved.payment_status === "unpaid", "Probe must remain open and unpaid");
      const items = retrieved.line_items;
      assert(items?.data?.length === 1 && items.has_more === false, "Probe line items differ");
      const item = items.data[0];
      assert(item.quantity === 1 && item.price?.unit_amount === quote.unitAmount && item.price.currency === "jpy"
        && item.price.tax_behavior === "inclusive", "Saved product amount differs");
      assert(retrieved.shipping_options?.length === 1, "Saved shipping options differ");
      const rate = retrieved.shipping_options[0].shipping_rate;
      assert(rate?.livemode === false && rate.type === "fixed_amount" && rate.fixed_amount?.amount === quote.shippingAmount
        && rate.fixed_amount.currency === "jpy" && rate.tax_behavior === "inclusive", "Saved shipping amount differs");
      // Tax/location and the final paid total require browser E2E, not a no-address connection probe.
    }
  } catch (error) {
    failure = { stage, reason: error instanceof ReadinessError ? error.message : "Stripe request failed; inspect the restricted provider logs" };
  } finally {
    // Attempt every known cleanup, including after validation or a later case fails.
    for (const probe of probes) {
      if (!probe.sessionId) continue;
      try {
        const current = await checkout.checkout.sessions.retrieve(probe.sessionId);
        assertProbeIdentity(current, probe);
        assert(current.payment_status === "unpaid" && current.payment_intent === null, "Probe unexpectedly started a payment");
        if (current.status === "open") {
          try { await checkout.checkout.sessions.expire(probe.sessionId); } catch {
            // An ambiguous expire response is resolved by authoritative retrieval below.
          }
        }
        const after = await checkout.checkout.sessions.retrieve(probe.sessionId);
        assertProbeIdentity(after, probe);
        assert(after.status === "expired" && after.payment_status === "unpaid" && after.payment_intent === null, "Probe expiry was not confirmed");
        probe.cleanup = "expired";
      } catch {
        probe.cleanup = "unconfirmed";
      }
    }
  }
  const cleaned = probes.length === 2 && probes.every((p) => p.cleanup === "expired");
  return {
    status: !failure && cleaned ? "connection_verified" : "failed",
    checkedAt: new Date().toISOString(), apiVersion: API_VERSION,
    revision: /^[0-9a-f]{40}$/.test(environment.GITHUB_SHA ?? "") ? environment.GITHUB_SHA : null,
    paymentVerification: "not_performed", finalTaxAndTotalVerification: "not_performed",
    failure: failure ?? (cleaned ? null : { stage: "cleanup", reason: "Probe expiry was not confirmed" }), probes,
  };
}

function assertProbeIdentity(session, probe) {
  assert(typeof session?.id === "string" && session.id.startsWith("cs_test_") && session.livemode === false
    && session.client_reference_id === probe.reference && (!probe.sessionId || session.id === probe.sessionId), "Probe Session identity differs");
}

function createClients(configuration) {
  const options = { apiVersion: API_VERSION, appInfo: { name: "BloomBox readiness", version: "0.1.0" }, maxNetworkRetries: 2, timeout: 10_000, telemetry: false };
  return {
    checkout: new Stripe(configuration.checkoutSecretKey, options),
    reconciliation: new Stripe(configuration.reconciliationSecretKey, options),
    readiness: new Stripe(configuration.readinessSecretKey, options),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyStripeTestMode(process.env, createClients);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "connection_verified") process.exitCode = 1;
}


export function loadConfiguration(environment) {
  const mode = required(environment, "STRIPE_MODE");
  assert(mode === "test", "This command is test-mode only and refuses live mode");

  const checkoutSecretKey = required(environment, "STRIPE_CHECKOUT_SECRET_KEY");
  const reconciliationSecretKey = required(environment, "STRIPE_RECONCILIATION_SECRET_KEY");
  const readinessSecretKey = required(environment, "STRIPE_READINESS_SECRET_KEY");
  for (const key of [checkoutSecretKey, reconciliationSecretKey, readinessSecretKey]) {
    assert(/^(?:sk|rk)_test_/.test(key), "All Stripe credentials must be test-mode server keys");
  }
  assert(
    new Set([checkoutSecretKey, reconciliationSecretKey, readinessSecretKey]).size === 3,
    "Checkout, reconciliation, and readiness credentials must be separate",
  );
  assert(/^whsec_.{10,}$/.test(required(environment, "STRIPE_WEBHOOK_SECRET")), "The webhook secret is invalid");

  const publicOrigin = parsePublicOrigin(required(environment, "BLOOMBOX_PUBLIC_ORIGIN"));
  const automaticTaxEnabled = parseBoolean(required(environment, "STRIPE_AUTOMATIC_TAX_ENABLED"));
  const taxBehavior = required(environment, "STRIPE_TAX_BEHAVIOR");
  assert(taxBehavior === "inclusive", "The one-box shipping probe requires inclusive tax");
  assert(
    automaticTaxEnabled === (taxBehavior !== "unspecified"),
    "Automatic tax and price tax behavior must be enabled or disabled together",
  );
  const termsAcceptance = required(environment, "STRIPE_TERMS_ACCEPTANCE");
  assert(["required", "none"].includes(termsAcceptance), "The Stripe terms-acceptance policy is invalid");

  const customHostname = optionalHostname(environment.STRIPE_CHECKOUT_CUSTOM_DOMAIN);
  return {
    checkoutSecretKey,
    reconciliationSecretKey,
    readinessSecretKey,
    accountId: required(environment, "STRIPE_ACCOUNT_ID", /^acct_/),
    shippingRateId: required(environment, "STRIPE_SHIPPING_RATE_ID", /^shr_/),
    automaticTaxEnabled,
    taxBehavior,
    termsAcceptance,
    publicOrigin,
    allowedCheckoutHostnames: ["checkout.stripe.com", ...(customHostname ? [customHostname] : [])],
  };
}

function required(environment, name, pattern) {
  const value = environment[name]?.trim();
  assert(value, `Missing required environment variable: ${name}`);
  if (pattern) assert(pattern.test(value), `Invalid environment variable: ${name}`);
  return value;
}

function parseBoolean(value) {
  assert(value === "true" || value === "false", "Boolean configuration must be true or false");
  return value === "true";
}

function parsePublicOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ReadinessError("The public origin is invalid");
  }
  assert(url.protocol === "https:", "The account-backed test deployment must use HTTPS");
  assert(url.origin === value.replace(/\/$/, ""), "The public origin must not contain a path, query, or fragment");
  return url.origin;
}

function optionalHostname(value) {
  if (!value) return undefined;
  assert(value === value.toLowerCase(), "The custom Checkout hostname must be lowercase");
  let url;
  try {
    url = new URL(`https://${value}`);
  } catch {
    throw new ReadinessError("The custom Checkout hostname is invalid");
  }
  assert(url.hostname === value && !url.port && url.pathname === "/", "The custom Checkout hostname must be a hostname only");
  return url.hostname;
}

function assertCheckoutUrl(value, allowedHostnames) {
  assert(value, "Stripe did not return a Checkout URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ReadinessError("Stripe returned an invalid Checkout URL");
  }
  assert(url.protocol === "https:" && !url.port && !url.username && !url.password, "Stripe returned an insecure Checkout URL");
  assert(allowedHostnames.includes(url.hostname), "Stripe returned an unapproved Checkout hostname");
}

function assertSameSet(actual, expected, message) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  assert(actualSet.size === expectedSet.size, message);
  for (const value of expectedSet) assert(actualSet.has(value), message);
}

function assert(condition, message) {
  if (!condition) throw new ReadinessError(message);
}
