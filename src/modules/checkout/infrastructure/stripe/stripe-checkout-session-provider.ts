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
  private readonly stripe: Stripe;

  constructor(private readonly config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: config.apiVersion,
      appInfo: { name: "BloomBox", version: "0.1.0" },
      maxNetworkRetries: 2,
      timeout: 10_000,
      telemetry: false,
    });
  }

  async create(request: StripeCheckoutRequest): Promise<StripeCheckoutResponse> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: request.purchaseIntentId,
      locale: "ja",
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
      cancel_url: `${this.config.publicOrigin}/gift/${encodeURIComponent(request.productId)}?checkout=cancelled`,
    }, { idempotencyKey: request.idempotencyKey });
    return mapStripeSession(session);
  }

  async retrieve(sessionId: string): Promise<StripeCheckoutResponse> {
    return mapStripeSession(await this.stripe.checkout.sessions.retrieve(sessionId));
  }
}

function mapStripeSession(session: Stripe.Checkout.Session): StripeCheckoutResponse {
  if (!session.url || !session.client_reference_id || !session.expires_at) {
    throw new StripeCheckoutResponseError();
  }
  return {
    id: session.id,
    purchaseIntentId: session.client_reference_id,
    url: session.url,
    expiresAt: new Date(session.expires_at * 1000),
  };
}
