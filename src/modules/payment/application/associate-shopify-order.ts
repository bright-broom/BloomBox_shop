import type { ShopifyOrderLinker, ShopifyOrderLink } from "@/modules/checkout/public";
import type { VerifiedProviderEvent } from "./receive-provider-webhook";
import type { ReadShopifyReference } from "./read-shopify-reference";

/** Internal workflow only. Reading the provider precedes the owner's atomic link write. */
export class AssociateShopifyOrder {
  constructor(private readonly reader: Pick<ReadShopifyReference, "execute">, private readonly linker: ShopifyOrderLinker) {}
  async execute(event: VerifiedProviderEvent): Promise<ShopifyOrderLink> {
    const snapshot = await this.reader.execute(event);
    return this.linker.link({ shop: snapshot.shop, orderId: snapshot.order.id, apiVersion: snapshot.apiVersion,
      cartToken: snapshot.order.cartToken, lines: snapshot.order.lines });
  }
}
