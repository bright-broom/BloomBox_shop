import { z } from "zod";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

const stripeEnvironmentSchema = z.object({
  STRIPE_MODE: z.enum(["test", "live"]),
  STRIPE_CHECKOUT_SECRET_KEY: z.string().min(16),
  STRIPE_RECONCILIATION_SECRET_KEY: z.string().min(16),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").min(16),
  STRIPE_ACCOUNT_ID: z.string().startsWith("acct_").min(8),
  STRIPE_SHIPPING_RATE_ID: z.string().startsWith("shr_").min(8),
  STRIPE_TAX_BEHAVIOR: z.enum(["inclusive", "exclusive", "unspecified"]),
  STRIPE_AUTOMATIC_TAX_ENABLED: z.enum(["true", "false"]),
  STRIPE_TERMS_ACCEPTANCE: z.enum(["required", "none"]),
  STRIPE_CHECKOUT_CUSTOM_DOMAIN: z.string().min(1).optional(),
  BLOOMBOX_PUBLIC_ORIGIN: z.string().url(),
});

export type StripeConfig = Readonly<{
  mode: "test" | "live";
  checkoutSecretKey: string;
  reconciliationSecretKey: string;
  webhookSecret: string;
  accountId: string;
  shippingRateId: string;
  taxBehavior: "inclusive" | "exclusive" | "unspecified";
  automaticTaxEnabled: boolean;
  termsAcceptance: "required" | "none";
  allowedCheckoutHostnames: readonly string[];
  publicOrigin: string;
  apiVersion: typeof STRIPE_API_VERSION;
}>;

export class InvalidStripeConfigurationError extends Error {
  constructor() {
    super("Stripe configuration is invalid");
    this.name = "InvalidStripeConfigurationError";
  }
}

export function loadStripeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): StripeConfig {
  const parsed = stripeEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new InvalidStripeConfigurationError();
  }
  if (
    !secretMatchesMode(parsed.data.STRIPE_CHECKOUT_SECRET_KEY, parsed.data.STRIPE_MODE)
    || !secretMatchesMode(parsed.data.STRIPE_RECONCILIATION_SECRET_KEY, parsed.data.STRIPE_MODE)
    || parsed.data.STRIPE_CHECKOUT_SECRET_KEY === parsed.data.STRIPE_RECONCILIATION_SECRET_KEY
  ) {
    throw new InvalidStripeConfigurationError();
  }

  let origin: URL;
  try {
    origin = new URL(parsed.data.BLOOMBOX_PUBLIC_ORIGIN);
  } catch {
    throw new InvalidStripeConfigurationError();
  }
  const localTestOrigin = parsed.data.STRIPE_MODE === "test"
    && ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !localTestOrigin) throw new InvalidStripeConfigurationError();

  const automaticTaxEnabled = parsed.data.STRIPE_AUTOMATIC_TAX_ENABLED === "true";
  const hasExplicitTaxBehavior = parsed.data.STRIPE_TAX_BEHAVIOR !== "unspecified";
  if (automaticTaxEnabled !== hasExplicitTaxBehavior) {
    throw new InvalidStripeConfigurationError();
  }

  const customCheckoutHostname = parseHostname(parsed.data.STRIPE_CHECKOUT_CUSTOM_DOMAIN);

  return {
    mode: parsed.data.STRIPE_MODE,
    checkoutSecretKey: parsed.data.STRIPE_CHECKOUT_SECRET_KEY,
    reconciliationSecretKey: parsed.data.STRIPE_RECONCILIATION_SECRET_KEY,
    webhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET,
    accountId: parsed.data.STRIPE_ACCOUNT_ID,
    shippingRateId: parsed.data.STRIPE_SHIPPING_RATE_ID,
    taxBehavior: parsed.data.STRIPE_TAX_BEHAVIOR,
    automaticTaxEnabled,
    termsAcceptance: parsed.data.STRIPE_TERMS_ACCEPTANCE,
    allowedCheckoutHostnames: [
      "checkout.stripe.com",
      ...(customCheckoutHostname ? [customCheckoutHostname] : []),
    ],
    publicOrigin: origin.origin,
    apiVersion: STRIPE_API_VERSION,
  };
}

function secretMatchesMode(secretKey: string, mode: "test" | "live"): boolean {
  const environment = mode === "test" ? "test" : "live";
  return secretKey.startsWith(`sk_${environment}_`) || secretKey.startsWith(`rk_${environment}_`);
}

function parseHostname(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value !== value.toLowerCase()) throw new InvalidStripeConfigurationError();

  let url: URL;
  try {
    url = new URL(`https://${value}`);
  } catch {
    throw new InvalidStripeConfigurationError();
  }
  if (
    url.hostname !== value
    || url.port
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new InvalidStripeConfigurationError();
  }
  return url.hostname;
}
