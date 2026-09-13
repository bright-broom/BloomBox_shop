import type { PurchaseIntent, PurchaseIntentId } from "../domain/purchase-intent";
import { purchaseIntentId } from "../domain/purchase-intent";
import { assertPurchaseCustomer, purchaseCustomer } from "../domain/purchase-customer";
import { anonymousPurchaseCustomer, type CurrentPurchaseCustomer } from "./current-purchase-customer";
import { PurchaseIntentNotFoundError } from "./start-checkout";

export class PurchaseCancellationUnavailableError extends Error {
  constructor() { super("決済手続きが始まっているため、この購入準備を取り消せません。"); this.name = "PurchaseCancellationUnavailableError"; }
}
export interface PurchaseCancellationRepository {
  findById(id: PurchaseIntentId): Promise<PurchaseIntent | null>;
  cancelBeforeCheckout(id: PurchaseIntentId): Promise<void>;
}
export class CancelPurchaseIntent {
  constructor(private readonly intents: PurchaseCancellationRepository, private readonly currentCustomer: CurrentPurchaseCustomer = anonymousPurchaseCustomer) {}
  async execute(rawId: string): Promise<void> {
    const id = purchaseIntentId(rawId);
    const intent = await this.intents.findById(id);
    if (!intent) throw new PurchaseIntentNotFoundError();
    assertPurchaseCustomer(intent.customer, purchaseCustomer(await this.currentCustomer()));
    await this.intents.cancelBeforeCheckout(id);
  }
}
