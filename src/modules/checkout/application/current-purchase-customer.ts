import type { PurchaseCustomer } from "../domain/purchase-customer";

/** Server-owned identity lookup. Never accepts identity fields from the purchase form. */
export type CurrentPurchaseCustomer = () => Promise<PurchaseCustomer | null>;
export const anonymousPurchaseCustomer: CurrentPurchaseCustomer = async () => null;
