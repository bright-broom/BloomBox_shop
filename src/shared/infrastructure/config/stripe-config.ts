import { z } from "zod";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

const stripeEnvironmentSchema = z.object({
  STRIPE_MODE: z.enum(["test", "live"]),
  STRIPE_SECRET_KEY: z.string().min(16),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").min(16),
  STRIPE_ACCOUNT_ID: z.string().startsWith("acct_").min(8),
  STRIPE_SHIPPING_RATE_ID: z.string().startsWith("shr_").min(8),
  STRIPE_TAX_BEHAVIOR: z.enum(["inclusive", "exclusive", "unspecified"]),
  BLOOMBOX_PUBLIC_ORIGIN: z.string().url(),
});

export type StripeConfig = Readonly<{
  mode: "test" | "live";
  secretKey: string;
  webhookSecret: string;
  accountId: string;
  shippingRateId: string;
  taxBehavior: "inclusive" | "exclusive" | "unspecified";
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
  if (!parsed.success || !secretMatchesMode(parsed.data.STRIPE_SECRET_KEY, parsed.data.STRIPE_MODE)) {
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

  return {
    mode: parsed.data.STRIPE_MODE,
    secretKey: parsed.data.STRIPE_SECRET_KEY,
    webhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET,
    accountId: parsed.data.STRIPE_ACCOUNT_ID,
    shippingRateId: parsed.data.STRIPE_SHIPPING_RATE_ID,
    taxBehavior: parsed.data.STRIPE_TAX_BEHAVIOR,
    publicOrigin: origin.origin,
    apiVersion: STRIPE_API_VERSION,
  };
}

function secretMatchesMode(secretKey: string, mode: "test" | "live"): boolean {
  return mode === "test" ? secretKey.startsWith("sk_test_") : secretKey.startsWith("sk_live_");
}
