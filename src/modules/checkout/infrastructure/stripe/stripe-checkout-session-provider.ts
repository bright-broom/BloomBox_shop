import { SHIPPING_QUOTE_MAX_QUANTITY } from "../../domain/purchase-shipping";
import { CheckoutPreparationUnavailableError } from "../../application/checkout-session-provider";
import Stripe from "stripe";
import type {
  CheckoutSession,
  CheckoutSessionProvider,
} from "../../application/checkout-session-provider";
import type { PurchaseIntent, PurchaseIntentId } from "../../domain/purchase-intent";
import {
  PurchaseCancellationUnconfirmedError,
  type CheckoutSessionCanceller,
} from "../../application/cancel-purchase-intent";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";

type StripeCheckoutRequest = Readonly<{
  purchaseIntentId: string;
  productId: string;
  externalProductReference: string;
  productName: string;
  quantity: number;
  unitAmount: number;
  shippingAmount?: number;
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
  validateCreate(request: Omit<StripeCheckoutRequest, "idempotencyKey">): void;
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

  validateCreate(intent: PurchaseIntent): void {
    this.api.validateCreate(this.toRequest(intent));
  }

  async create(intent: PurchaseIntent, idempotencyKey: string): Promise<CheckoutSession> {
    const session = await this.api.create({ ...this.toRequest(intent), idempotencyKey });
    return this.toCheckoutSession(session);
  }

  private toRequest(intent: PurchaseIntent): Omit<StripeCheckoutRequest, "idempotencyKey"> {
    if (intent.item.productId.startsWith("native_") && intent.shippingAmount === null) {
      throw new CheckoutPreparationUnavailableError();
    }
    return {
      purchaseIntentId: intent.id,
      productId: intent.item.productId,
      externalProductReference: intent.item.externalProductReference,
      productName: intent.item.productName,
      quantity: intent.item.quantity,
      unitAmount: intent.item.unitPriceSnapshot.amount - (intent.loyalty?.discountYen ?? 0),
      shippingAmount: intent.shippingAmount?.amount,
      currency: intent.item.unitPriceSnapshot.currency,
      expiresAt: intent.expiresAt,
    };
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
    const stripe = createStripeCheckoutClient(config);
    this.sessions = sessions ?? {
      // Pin the wire API independently of the SDK's latest-only constructor type.
      create: (request, options) => stripe.checkout.sessions.create(request, { ...options, apiVersion: config.apiVersion }),
      retrieve: (sessionId) => stripe.checkout.sessions.retrieve(sessionId, {}, { apiVersion: config.apiVersion }),
    };
  }

  validateCreate(request: Omit<StripeCheckoutRequest, "idempotencyKey">): void {
    if (request.productId.startsWith("native_") && request.shippingAmount === undefined) throw new CheckoutPreparationUnavailableError();
    if (request.shippingAmount !== undefined && (
      !Number.isSafeInteger(request.shippingAmount) || request.shippingAmount < 0
      || request.quantity !== SHIPPING_QUOTE_MAX_QUANTITY || this.config.taxBehavior !== "inclusive"
      || !Number.isSafeInteger(request.unitAmount + request.shippingAmount)
    )) throw new CheckoutPreparationUnavailableError();
  }

  async create(request: StripeCheckoutRequest): Promise<StripeCheckoutResponse> {
    this.validateCreate(request);
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
      shipping_options: [request.shippingAmount === undefined
        ? { shipping_rate: this.config.shippingRateId }
        : { shipping_rate_data: {
          type: "fixed_amount", display_name: "配送料",
          fixed_amount: { amount: request.shippingAmount, currency: request.currency.toLowerCase() },
          tax_behavior: this.config.taxBehavior,
        } }],
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

type StripeCheckoutSessionState = Readonly<{
  id: string;
  client_reference_id: string | null;
  status: string | null;
  livemode: boolean;
}>;

export interface StripeCheckoutExpiryClient {
  expire(sessionId: string): Promise<StripeCheckoutSessionState>;
  retrieve(sessionId: string): Promise<StripeCheckoutSessionState>;
}

/**
 * Customer-initiated closure of an issued hosted checkout. Inventory is not released here:
 * the verified `checkout.session.expired` event for the stored session remains authoritative.
 */
export class StripeCheckoutSessionCanceller implements CheckoutSessionCanceller {
  readonly provider = "STRIPE" as const;
  private readonly sessions: StripeCheckoutExpiryClient;

  constructor(
    private readonly config: StripeConfig,
    sessions?: StripeCheckoutExpiryClient,
  ) {
    this.sessions = sessions ?? sdkExpiryClient(createStripeCheckoutClient(config), config.apiVersion);
  }

  async expire(externalCheckoutId: string, purchaseIntentId: PurchaseIntentId): Promise<"EXPIRED" | "COMPLETED"> {
    let expireFailure: Readonly<{ error: unknown }> | null = null;
    try {
      const expired = await this.sessions.expire(externalCheckoutId);
      if (this.verified(expired, externalCheckoutId, purchaseIntentId).status === "expired") return "EXPIRED";
    } catch (error) {
      if (error instanceof StripeCheckoutResponseError) throw error;
      // A session that is no longer open, a timeout, or an ambiguous response is settled by retrieval.
      expireFailure = { error };
    }
    let current: StripeCheckoutSessionState;
    try {
      current = await this.sessions.retrieve(externalCheckoutId);
    } catch (error) {
      throw new PurchaseCancellationUnconfirmedError({ cause: error });
    }
    const status = this.verified(current, externalCheckoutId, purchaseIntentId).status;
    if (status === "expired") return "EXPIRED";
    if (status === "complete") return "COMPLETED";
    // Stripe refused to close a session it still reports as open: surface the provider failure itself.
    if (expireFailure) throw expireFailure.error;
    throw new PurchaseCancellationUnconfirmedError();
  }

  private verified(
    session: StripeCheckoutSessionState,
    externalCheckoutId: string,
    purchaseIntentId: PurchaseIntentId,
  ): StripeCheckoutSessionState {
    const expectedIdPrefix = this.config.mode === "test" ? "cs_test_" : "cs_live_";
    if (
      session.id !== externalCheckoutId
      || !session.id.startsWith(expectedIdPrefix)
      || session.livemode !== (this.config.mode === "live")
      || session.client_reference_id !== purchaseIntentId
    ) {
      throw new StripeCheckoutResponseError();
    }
    return session;
  }
}

function createStripeCheckoutClient(config: StripeConfig): Stripe {
  return new Stripe(config.checkoutSecretKey, {
    appInfo: { name: "BloomBox", version: "0.1.0" },
    maxNetworkRetries: 2,
    timeout: 10_000,
    telemetry: false,
  });
}

function sdkExpiryClient(stripe: Stripe, apiVersion: string): StripeCheckoutExpiryClient {
  return {
    // Pin the wire API independently of the SDK's latest-only constructor type.
    expire: (sessionId) => stripe.checkout.sessions.expire(sessionId, {}, { apiVersion }),
    retrieve: (sessionId) => stripe.checkout.sessions.retrieve(sessionId, {}, { apiVersion }),
  };
}
