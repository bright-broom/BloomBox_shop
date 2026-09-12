import Stripe from "stripe";
import type {
  CheckoutSession,
  CheckoutSessionProvider,
} from "../../application/checkout-session-provider";
import type { PurchaseIntent } from "../../domain/purchase-intent";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";

type StripeCheckoutRequest = Readonly<{
  purchaseIntentId: string;
  productId: string;
  externalProductReference: string;
  productName: string;
  quantity: number;
  unitAmount: number;
  currency: "JPY";
  expiresAt: Date;
  idempotencyKey: string;
}>;

type StripeCheckoutResponse = Readonly<{
  id: string;
  purchaseIntentId: string;
  url: string;
  expiresAt: Date;
}>;

type StripeCheckoutSessionResource = Readonly<{
  id: string;
  client_reference_id: string | null;
  url: string | null;
  expires_at: number;
  livemode: boolean;
}>;

export interface StripeCheckoutSessionsClient {
  create(
    request: Stripe.Checkout.SessionCreateParams,
    options: Readonly<{ idempotencyKey: string }>,
  ): Promise<StripeCheckoutSessionResource>;
  retrieve(sessionId: string): Promise<StripeCheckoutSessionResource>;
}

export interface StripeCheckoutApi {
  create(request: StripeCheckoutRequest): Promise<StripeCheckoutResponse>;
  retrieve(sessionId: string): Promise<StripeCheckoutResponse>;
}

export class StripeCheckoutResponseError extends Error {
  constructor() {
    super("Stripe Checkout returned an invalid response");
    this.name = "StripeCheckoutResponseError";
  }
}

export class StripeCheckoutSessionProvider implements CheckoutSessionProvider {
  readonly provider = "STRIPE" as const;

  constructor(
    private readonly api: StripeCheckoutApi,
    private readonly apiVersion: string,
  ) {}

  create(intent: PurchaseIntent, idempotencyKey: string): Promise<CheckoutSession> {
    return this.api.create({
      purchaseIntentId: intent.id,
      productId: intent.item.productId,
      externalProductReference: intent.item.externalProductReference,
      productName: intent.item.productName,
      quantity: intent.item.quantity,
      unitAmount: intent.item.unitPriceSnapshot.amount,
      currency: intent.item.unitPriceSnapshot.currency,
      expiresAt: intent.expiresAt,
      idempotencyKey,
    }).then((session) => this.toCheckoutSession(session));
  }

  retrieve(externalCheckoutId: string): Promise<CheckoutSession> {
    return this.api.retrieve(externalCheckoutId).then((session) => this.toCheckoutSession(session));
  }

  private toCheckoutSession(session: StripeCheckoutResponse): CheckoutSession {
    return {
      provider: this.provider,
      ...session,
      apiVersion: this.apiVersion,
    };
  }
}

export class StripeSdkCheckoutApi implements StripeCheckoutApi {
  private readonly sessions: StripeCheckoutSessionsClient;

  constructor(
    private readonly config: StripeConfig,
    sessions?: StripeCheckoutSessionsClient,
  ) {
    const stripe = new Stripe(config.checkoutSecretKey, {
      appInfo: { name: "BloomBox", version: "0.1.0" },
      maxNetworkRetries: 2,
      timeout: 10_000,
      telemetry: false,
    });
    this.sessions = sessions ?? {
      // Pin the wire API independently of the SDK's latest-only constructor type.
      create: (request, options) => stripe.checkout.sessions.create(request, { ...options, apiVersion: config.apiVersion }),
      retrieve: (sessionId) => stripe.checkout.sessions.retrieve(sessionId, {}, { apiVersion: config.apiVersion }),
    };
  }

  async create(request: StripeCheckoutRequest): Promise<StripeCheckoutResponse> {
    const session = await this.sessions.create({
      mode: "payment",
      client_reference_id: request.purchaseIntentId,
      locale: "ja",
      submit_type: "pay",
      billing_address_collection: "auto",
      automatic_tax: { enabled: this.config.automaticTaxEnabled },
      consent_collection: { terms_of_service: this.config.termsAcceptance },
      line_items: [{
        price_data: {
          currency: request.currency.toLowerCase(),
          unit_amount: request.unitAmount,
          tax_behavior: this.config.taxBehavior,
          product_data: {
            name: request.productName,
            metadata: {
              catalog_product_id: request.productId,
              commerce_product_reference: request.externalProductReference,
            },
          },
        },
        quantity: request.quantity,
      }],
      shipping_address_collection: { allowed_countries: ["JP"] },
      shipping_options: [{ shipping_rate: this.config.shippingRateId }],
      phone_number_collection: { enabled: true },
      payment_intent_data: {
        metadata: { purchase_intent_id: request.purchaseIntentId },
      },
      metadata: { purchase_intent_id: request.purchaseIntentId },
      expires_at: Math.floor(request.expiresAt.getTime() / 1000),
      success_url: `${this.config.publicOrigin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.config.publicOrigin}/cart?checkout=cancelled`,
    }, { idempotencyKey: request.idempotencyKey });
    return mapStripeSession(session, this.config);
  }

  async retrieve(sessionId: string): Promise<StripeCheckoutResponse> {
    return mapStripeSession(await this.sessions.retrieve(sessionId), this.config);
  }
}

function mapStripeSession(
  session: StripeCheckoutSessionResource,
  config: StripeConfig,
): StripeCheckoutResponse {
  if (!session.url || !session.client_reference_id || !session.expires_at) {
    throw new StripeCheckoutResponseError();
  }
  const expectedIdPrefix = config.mode === "test" ? "cs_test_" : "cs_live_";
  if (!session.id.startsWith(expectedIdPrefix) || session.livemode !== (config.mode === "live")) {
    throw new StripeCheckoutResponseError();
  }
  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(session.url);
  } catch {
    throw new StripeCheckoutResponseError();
  }
  if (
    checkoutUrl.protocol !== "https:"
    || checkoutUrl.port
    || checkoutUrl.username
    || checkoutUrl.password
    || !config.allowedCheckoutHostnames.includes(checkoutUrl.hostname)
  ) {
    throw new StripeCheckoutResponseError();
  }
  return {
    id: session.id,
    purchaseIntentId: session.client_reference_id,
    url: checkoutUrl.toString(),
    expiresAt: new Date(session.expires_at * 1000),
  };
}
