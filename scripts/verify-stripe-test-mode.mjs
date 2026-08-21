import { randomUUID } from "node:crypto";
import Stripe from "stripe";

const API_VERSION = "2026-07-29.dahlia";
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

const configuration = loadConfiguration(process.env);
const clientOptions = {
  apiVersion: API_VERSION,
  appInfo: { name: "BloomBox readiness", version: "0.1.0" },
  maxNetworkRetries: 2,
  timeout: 10_000,
  telemetry: false,
};
const checkoutStripe = new Stripe(configuration.checkoutSecretKey, clientOptions);
const reconciliationStripe = new Stripe(configuration.reconciliationSecretKey, clientOptions);
const readinessStripe = new Stripe(configuration.readinessSecretKey, clientOptions);

let probeSession;
try {
  const account = await readinessStripe.accounts.retrieveCurrent();
  assert(account.id === configuration.accountId, "The configured Stripe account ID does not match the credential");

  const shippingRate = await readinessStripe.shippingRates.retrieve(configuration.shippingRateId);
  assert(shippingRate.active, "The configured shipping rate is inactive");
  assert(!shippingRate.livemode, "The configured shipping rate is not a test-mode object");
  assert(shippingRate.type === "fixed_amount", "The configured shipping rate is not fixed-amount");
  assert(shippingRate.fixed_amount?.currency === "jpy", "The configured shipping rate is not JPY");
  assert(
    shippingRate.tax_behavior === configuration.taxBehavior,
    "The shipping-rate tax behavior differs from the Checkout price tax behavior",
  );

  if (configuration.automaticTaxEnabled) {
    const taxSettings = await readinessStripe.tax.settings.retrieve();
    assert(!taxSettings.livemode, "Stripe Tax settings are not in test mode");
    assert(taxSettings.status === "active", "Stripe Tax settings are not active");
  }

  if (configuration.termsAcceptance === "required") {
    assert(
      Boolean(account.business_profile?.terms_of_service_url),
      "Terms acceptance is required, but the Stripe business profile has no terms URL",
    );
  }

  const webhookUrl = `${configuration.publicOrigin}/api/webhooks/stripe`;
  const matchingEndpoints = [];
  for await (const endpoint of readinessStripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url === webhookUrl) matchingEndpoints.push(endpoint);
  }
  assert(matchingEndpoints.length === 1, "Exactly one Stripe webhook endpoint must match the test deployment URL");
  const endpoint = matchingEndpoints[0];
  assert(endpoint.status === "enabled", "The Stripe webhook endpoint is disabled");
  assert(!endpoint.livemode, "The Stripe webhook endpoint is not a test-mode object");
  assert(endpoint.api_version === API_VERSION, "The Stripe webhook endpoint API version is not pinned");
  assertSameSet(endpoint.enabled_events, REQUIRED_WEBHOOK_EVENTS, "Stripe webhook event subscriptions differ from the application contract");

  await reconciliationStripe.events.list({ limit: 1 });

  const purchaseIntentId = randomUUID();
  probeSession = await checkoutStripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: purchaseIntentId,
    locale: "ja",
    submit_type: "pay",
    billing_address_collection: "auto",
    automatic_tax: { enabled: configuration.automaticTaxEnabled },
    consent_collection: { terms_of_service: configuration.termsAcceptance },
    line_items: [{
      price_data: {
        currency: "jpy",
        unit_amount: 1_000,
        tax_behavior: configuration.taxBehavior,
        product_data: {
          name: "BloomBox Stripe 接続確認",
          metadata: { readiness_probe: "true" },
        },
      },
      quantity: 1,
    }],
    shipping_address_collection: { allowed_countries: ["JP"] },
    shipping_options: [{ shipping_rate: configuration.shippingRateId }],
    phone_number_collection: { enabled: true },
    payment_intent_data: { metadata: { purchase_intent_id: purchaseIntentId } },
    metadata: { purchase_intent_id: purchaseIntentId, readiness_probe: "true" },
    expires_at: Math.floor(Date.now() / 1_000) + 31 * 60,
    success_url: `${configuration.publicOrigin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${configuration.publicOrigin}/flowers?checkout=cancelled`,
  }, { idempotencyKey: `stripe-readiness:${purchaseIntentId}` });

  assert(probeSession.id.startsWith("cs_test_"), "Stripe returned a non-test Checkout Session");
  assert(!probeSession.livemode, "Stripe returned a live-mode Checkout Session");
  assert(probeSession.client_reference_id === purchaseIntentId, "Stripe changed the Checkout client reference");
  assertCheckoutUrl(probeSession.url, configuration.allowedCheckoutHostnames);

  const retrieved = await checkoutStripe.checkout.sessions.retrieve(probeSession.id);
  assert(retrieved.client_reference_id === purchaseIntentId, "The Checkout credential cannot retrieve its own Session");

  console.log(JSON.stringify({
    status: "ready",
    checkedAt: new Date().toISOString(),
    apiVersion: API_VERSION,
    accountId: account.id,
    shippingRateId: shippingRate.id,
    webhookEndpointId: endpoint.id,
    checkoutSessionId: probeSession.id,
    checkoutSessionCleanup: "expired",
  }, null, 2));
} finally {
  if (probeSession?.id && probeSession.status === "open") {
    await checkoutStripe.checkout.sessions.expire(probeSession.id);
  }
}

function loadConfiguration(environment) {
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
  assert(["inclusive", "exclusive", "unspecified"].includes(taxBehavior), "The Stripe tax behavior is invalid");
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
    throw new Error("The public origin is invalid");
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
    throw new Error("The custom Checkout hostname is invalid");
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
    throw new Error("Stripe returned an invalid Checkout URL");
  }
  assert(url.protocol === "https:" && !url.port, "Stripe returned an insecure Checkout URL");
  assert(allowedHostnames.includes(url.hostname), "Stripe returned an unapproved Checkout hostname");
}

function assertSameSet(actual, expected, message) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  assert(actualSet.size === expectedSet.size, message);
  for (const value of expectedSet) assert(actualSet.has(value), message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
