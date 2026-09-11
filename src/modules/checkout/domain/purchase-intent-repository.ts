import type { PurchaseIntent, PurchaseIntentId, CommerceProvider } from "./purchase-intent";

export interface PurchaseIntentRepository {
  save(intent: PurchaseIntent): Promise<void>;
  findById(id: PurchaseIntentId): Promise<PurchaseIntent | null>;
  claimCommerceProvider(id: PurchaseIntentId, provider: CommerceProvider): Promise<void>;
  saveCheckoutCreated(intent: PurchaseIntent): Promise<void>;
}

export class PurchaseIntentAlreadyExistsError extends Error {
  constructor() {
    super("Purchase intent already exists");
    this.name = "PurchaseIntentAlreadyExistsError";
  }
}

export class PurchaseIntentConcurrencyError extends Error {
  constructor() {
    super("Purchase intent was changed by another operation");
    this.name = "PurchaseIntentConcurrencyError";
  }
}
