import type { PurchaseIntent, PurchaseIntentId } from "./purchase-intent";

export interface PurchaseIntentRepository {
  save(intent: PurchaseIntent): Promise<void>;
  findById(id: PurchaseIntentId): Promise<PurchaseIntent | null>;
}
