import type { PurchaseIntent, PurchaseIntentId } from "../domain/purchase-intent";
import type { PurchaseIntentRepository } from "../domain/purchase-intent-repository";

const intents = new Map<PurchaseIntentId, PurchaseIntent>();

export class InMemoryPurchaseIntentRepository implements PurchaseIntentRepository {
  async save(intent: PurchaseIntent): Promise<void> {
    intents.set(intent.id, intent);
  }

  async findById(id: PurchaseIntentId): Promise<PurchaseIntent | null> {
    return intents.get(id) ?? null;
  }
}
