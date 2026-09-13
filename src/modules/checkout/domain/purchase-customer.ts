export type PurchaseCustomer = Readonly<{ customerId: string; version: number }>;

export class PurchaseCustomerMismatchError extends Error {
  constructor() {
    super("この購入操作を続けられません。ログイン状態を確認し、最初からやり直してください。");
    this.name = "PurchaseCustomerMismatchError";
  }
}

export function purchaseCustomer(value: PurchaseCustomer | null): PurchaseCustomer | null {
  if (value === null) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.customerId)
    || !Number.isSafeInteger(value.version) || value.version < 1) throw new PurchaseCustomerMismatchError();
  return Object.freeze({ customerId: value.customerId.toLowerCase(), version: value.version });
}

export function assertPurchaseCustomer(stored: PurchaseCustomer | null, current: PurchaseCustomer | null): void {
  // A renewed session may have a newer version, but cannot change the original owner.
  if (stored?.customerId !== current?.customerId) throw new PurchaseCustomerMismatchError();
}
