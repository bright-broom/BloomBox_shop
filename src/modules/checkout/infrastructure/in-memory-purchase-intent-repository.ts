import type { PurchaseIntent, PurchaseIntentId } from "../domain/purchase-intent";
import type { PurchaseIntentRepository } from "../domain/purchase-intent-repository";

export class InMemoryPurchaseIntentRepository implements PurchaseIntentRepository {
  private readonly intents = new Map<PurchaseIntentId, PurchaseIntent>();

  async save(intent: PurchaseIntent): Promise<void> {
    this.intents.set(intent.id, intent);
  }

  async findById(id: PurchaseIntentId): Promise<PurchaseIntent | null> {
    return this.intents.get(id) ?? null;
  }
}
