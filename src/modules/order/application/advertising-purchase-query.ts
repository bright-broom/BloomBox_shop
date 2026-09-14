export type AdvertisingPurchase = Readonly<{ orderId: string; confirmedAt: Date; value: number; currency: "JPY" }>;
/** Only fully captured live native purchases, without customer/recipient details. */
export interface AdvertisingPurchaseQuery {
  findConfirmedPurchase(intentId: string): Promise<AdvertisingPurchase | null>;
}
