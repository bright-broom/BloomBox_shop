import type { PurchaseIntent, PurchaseIntentId, CommerceProvider } from "../domain/purchase-intent";
import type { PurchaseIntentRepository } from "../domain/purchase-intent-repository";
import {
  PurchaseIntentAlreadyExistsError,
  PurchaseIntentConcurrencyError,
} from "../domain/purchase-intent-repository";

export class InMemoryPurchaseIntentRepository implements PurchaseIntentRepository {
  private readonly intents = new Map<PurchaseIntentId, PurchaseIntent>();

  async save(intent: PurchaseIntent): Promise<void> {
    if (this.intents.has(intent.id)) throw new PurchaseIntentAlreadyExistsError();
    this.intents.set(intent.id, intent);
  }

  async findById(id: PurchaseIntentId): Promise<PurchaseIntent | null> {
    return this.intents.get(id) ?? null;
  }

  async claimCommerceProvider(id: PurchaseIntentId, provider: CommerceProvider): Promise<void> {
    const intent = this.intents.get(id);
    if (!intent || intent.status !== "READY_FOR_CHECKOUT"
      || (intent.commerceProvider && intent.commerceProvider !== provider)) throw new PurchaseIntentConcurrencyError();
    intent.selectCommerceProvider(provider);
  }

  async saveCheckoutCreated(intent: PurchaseIntent): Promise<void> {
    if (!this.intents.has(intent.id) || intent.status !== "CHECKOUT_CREATED") {
      throw new PurchaseIntentConcurrencyError();
    }
    this.intents.set(intent.id, intent);
  }
}
