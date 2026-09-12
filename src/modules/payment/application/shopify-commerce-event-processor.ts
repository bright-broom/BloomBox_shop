import type { ProviderEventProcessor, VerifiedProviderEvent } from "./receive-provider-webhook";
import type { ReconcileShopifyPayment } from "./reconcile-shopify-payment";
import { InvalidShopifyReferenceError } from "./read-shopify-reference";

export class ShopifyCommerceIncompleteError extends Error {
  constructor() { super("Shopify commerce reconciliation is incomplete"); this.name = "ShopifyCommerceIncompleteError"; }
}

/** Queue completion means all local owner commands committed, never permission to dispatch. */
export class ShopifyCommerceEventProcessor implements ProviderEventProcessor {
  constructor(
    private readonly reconciliation: Pick<ReconcileShopifyPayment, "execute">,
    private readonly scope: Readonly<{ shop: string; apiVersion: string }>,
  ) {}

  async process(event: VerifiedProviderEvent): Promise<void> {
    if (event.provider !== "SHOPIFY" || event.providerAccountId !== this.scope.shop
      || event.apiVersion !== this.scope.apiVersion) throw new InvalidShopifyReferenceError();
    const result = await this.reconciliation.execute(event);
    if (result.acceptance.outcome === "HELD" || result.completion.outcome !== "COMPLETED"
      || result.completion.fulfillment.outcome === "HELD") throw new ShopifyCommerceIncompleteError();
  }
}
