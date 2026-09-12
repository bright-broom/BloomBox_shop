import type { ShopifyCartHandoff, ShopifyCartProvider } from "../../application/shopify-checkout-attempt";
import { z } from "zod";
import type { ShopifyCheckoutConfig } from "@/shared/infrastructure/config/shopify-checkout-config";
import type { PurchaseIntent } from "../../domain/purchase-intent";
import { GIFT_QUANTITY_MAX, GIFT_QUANTITY_MIN } from "../../domain/purchase-intent-policy";

export const SHOPIFY_CART_TIMEOUT_MS = 8_000;
export const SHOPIFY_CART_RESPONSE_MAX_BYTES = 128_000;
const INTENT_ATTRIBUTE = "bloombox_purchase_intent_id";
const variantIdSchema = z.string().regex(/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/);
// Shopify can change the opaque token format; validate the envelope, not its encoding.
const cartIdSchema = z.string().max(SHOPIFY_CART_RESPONSE_MAX_BYTES).refine((value) => {
  if (!value.startsWith("gid://shopify/Cart/") || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.pathname.length > "/Cart/".length && !url.hash
      && url.searchParams.getAll("key").length === 1 && Boolean(url.searchParams.get("key"));
  } catch {
    return false;
  }
});
const quantitySchema = z.number().int().min(GIFT_QUANTITY_MIN).max(GIFT_QUANTITY_MAX);
const amountSchema = z.string().regex(/^\d+(?:\.0+)?$/).transform(Number)
  .refine(Number.isSafeInteger);
const moneySchema = z.object({ amount: amountSchema, currencyCode: z.literal("JPY") });
const cartSchema = z.object({
  id: cartIdSchema,
  checkoutUrl: z.string().max(8192),
  attributes: z.array(z.object({ key: z.string(), value: z.string() })).max(250),
  totalQuantity: quantitySchema,
  lines: z.object({
    nodes: z.array(z.object({
      quantity: quantitySchema,
      merchandise: z.object({
        __typename: z.literal("ProductVariant"), id: variantIdSchema,
      }),
      cost: z.object({ amountPerQuantity: moneySchema, subtotalAmount: moneySchema }),
    })).length(1),
    pageInfo: z.object({ hasNextPage: z.literal(false) }),
  }),
});

export type { ShopifyCartHandoff } from "../../application/shopify-checkout-attempt";

export class ShopifyCartInputError extends Error {
  constructor() {
    super("Shopify cart input is invalid");
    this.name = "ShopifyCartInputError";
  }
}

export class ShopifyCartUnavailableError extends Error {
  constructor() {
    super("Shopify cart is unavailable or differs from the purchase intent");
    this.name = "ShopifyCartUnavailableError";
  }
}

export class ShopifyCartCreationUncertainError extends Error {
  constructor() {
    super("Shopify cart creation requires reconciliation before another attempt");
    this.name = "ShopifyCartCreationUncertainError";
  }
}

const CART_FIELDS = `
  id checkoutUrl totalQuantity
  attributes { key value }
  lines(first: 2) {
    nodes {
      quantity
      merchandise { __typename ... on ProductVariant { id } }
      cost { amountPerQuantity { amount currencyCode } subtotalAmount { amount currencyCode } }
    }
    pageInfo { hasNextPage }
  }
`;
const CREATE_CART = `mutation BloomBoxCartCreate($input: CartInput!)
  @inContext(country: JP, language: JA) {
  cartCreate(input: $input) {
    cart { ${CART_FIELDS} }
    userErrors { code }
    warnings { code }
  }
}`;
const RETRIEVE_CART = `query BloomBoxCart($id: ID!)
  @inContext(country: JP, language: JA) { cart(id: $id) { ${CART_FIELDS} } }`;

/** Disabled infrastructure boundary: not wired to the live purchase flow.
 * Cart creation has no assumed idempotency or enforceable 24-hour expiry.
 * StartShopifyCheckout owns durable attempts; ownership checks and verified order processing still precede activation.
 */
export class ShopifyCartClient implements ShopifyCartProvider {
  get scope(): string { return this.config.storeDomain; }
  constructor(
    private readonly config: ShopifyCheckoutConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(intent: PurchaseIntent): Promise<ShopifyCartHandoff> {
    validateIntent(intent);
    if (intent.status !== "READY_FOR_CHECKOUT" || intent.expiresAt <= this.now()) {
      throw new ShopifyCartInputError();
    }
    try {
      const response = await this.request(CREATE_CART, {
        input: {
          buyerIdentity: { countryCode: "JP" },
          lines: [{ merchandiseId: intent.item.externalProductReference, quantity: intent.item.quantity }],
          // Buyer/recipient details and gift messages stay in BloomBox's protected store.
          attributes: [{ key: INTENT_ATTRIBUTE, value: intent.id }],
        },
      });
      const parsed = z.object({
        errors: z.array(z.unknown()).max(0).optional(),
        data: z.object({ cartCreate: z.object({
          cart: cartSchema,
          userErrors: z.array(z.unknown()).max(0),
          warnings: z.array(z.unknown()).max(0),
        }) }),
      }).safeParse(response);
      if (!parsed.success) throw new ShopifyCartCreationUncertainError();
      return this.mapCart(parsed.data.data.cartCreate.cart, intent);
    } catch {
      // Even a bad response may follow a successful mutation. Never retry blindly.
      throw new ShopifyCartCreationUncertainError();
    }
  }

  async retrieve(cartId: string, intent: PurchaseIntent): Promise<ShopifyCartHandoff> {
    validateIntent(intent);
    if (!cartIdSchema.safeParse(cartId).success) throw new ShopifyCartInputError();
    try {
      const response = await this.request(RETRIEVE_CART, { id: cartId });
      const parsed = z.object({
        errors: z.array(z.unknown()).max(0).optional(),
        data: z.object({ cart: cartSchema }),
      }).safeParse(response);
      if (!parsed.success || parsed.data.data.cart.id !== cartId) throw new ShopifyCartUnavailableError();
      return this.mapCart(parsed.data.data.cart, intent);
    } catch {
      throw new ShopifyCartUnavailableError();
    }
  }

  private mapCart(cart: z.infer<typeof cartSchema>, intent: PurchaseIntent): ShopifyCartHandoff {
    const line = cart.lines.nodes[0];
    const reference = cart.attributes.filter((attribute) => attribute.key === INTENT_ATTRIBUTE);
    const url = new URL(cart.checkoutUrl);
    if (
      reference.length !== 1 || reference[0].value !== intent.id
      || line.merchandise.id !== intent.item.externalProductReference
      || line.quantity !== intent.item.quantity || cart.totalQuantity !== intent.item.quantity
      || line.cost.amountPerQuantity.amount !== intent.item.unitPriceSnapshot.amount
      || line.cost.subtotalAmount.amount !== intent.item.subtotal.amount
      || url.protocol !== "https:" || url.port || url.username || url.password || url.hash
      || !this.config.allowedCheckoutHostnames.includes(url.hostname)
    ) throw new ShopifyCartUnavailableError();
    return {
      cartId: cart.id,
      checkoutUrl: url.toString(),
      purchaseIntentId: intent.id,
      apiVersion: this.config.apiVersion,
    };
  }

  private async request(query: string, variables: Readonly<Record<string, unknown>>): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SHOPIFY_CART_TIMEOUT_MS);
    try {
      const response = await this.fetchImplementation(
        `https://${this.config.storeDomain}/api/${this.config.apiVersion}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Storefront-Access-Token": this.config.accessToken,
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
          redirect: "error",
          cache: "no-store",
        },
      );
      if (
        !response.ok || !response.body
        || response.headers.get("x-shopify-api-version") !== this.config.apiVersion
      ) throw new ShopifyCartUnavailableError();
      // Bound memory before parsing, including chunked responses without Content-Length.
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > SHOPIFY_CART_RESPONSE_MAX_BYTES) {
            await reader.cancel();
            throw new ShopifyCartUnavailableError();
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateIntent(intent: PurchaseIntent): void {
  if (
    !z.uuid().safeParse(intent.id).success
    || !variantIdSchema.safeParse(intent.item.externalProductReference).success
    || !quantitySchema.safeParse(intent.item.quantity).success
    || intent.item.unitPriceSnapshot.currency !== "JPY" || intent.item.subtotal.currency !== "JPY"
    || !Number.isSafeInteger(intent.item.unitPriceSnapshot.amount)
    || intent.item.unitPriceSnapshot.amount <= 0
    || !Number.isSafeInteger(intent.item.subtotal.amount)
    || intent.item.subtotal.amount !== intent.item.unitPriceSnapshot.amount * intent.item.quantity
  ) throw new ShopifyCartInputError();
}
