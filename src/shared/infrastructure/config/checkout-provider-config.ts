import { z } from "zod";

const checkoutProviderEnvironmentSchema = z.object({
  BLOOMBOX_CHECKOUT_PROVIDER: z.enum(["preview", "stripe"]).default("preview"),
});

export type CheckoutProviderMode = "preview" | "stripe";

export class InvalidCheckoutProviderConfigurationError extends Error {
  constructor() {
    super("Checkout provider configuration is invalid");
    this.name = "InvalidCheckoutProviderConfigurationError";
  }
}

export function loadCheckoutProviderMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CheckoutProviderMode {
  const parsed = checkoutProviderEnvironmentSchema.safeParse(environment);
  if (!parsed.success) throw new InvalidCheckoutProviderConfigurationError();
  return parsed.data.BLOOMBOX_CHECKOUT_PROVIDER;
}
