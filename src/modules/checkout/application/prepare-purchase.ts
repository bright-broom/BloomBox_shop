import type { CreatePurchaseIntent, CreatePurchaseIntentInput } from "./create-purchase-intent";
import type { CheckoutSession } from "./checkout-session-provider";
import type { PurchaseIntent } from "../domain/purchase-intent";
import type { StartCheckout } from "./start-checkout";

export type PreparedPurchase = Readonly<{
  intent: PurchaseIntent;
  checkoutSession?: CheckoutSession;
}>;

export class PreparePurchase {
  constructor(
    private readonly createPurchaseIntent: CreatePurchaseIntent,
    private readonly startCheckout?: StartCheckout,
  ) {}

  async execute(input: CreatePurchaseIntentInput): Promise<PreparedPurchase> {
    const intent = await this.createPurchaseIntent.execute(input);
    if (!this.startCheckout) return { intent };

    const checkoutSession = await this.startCheckout.execute(intent.id);
    return { intent, checkoutSession };
  }
}
