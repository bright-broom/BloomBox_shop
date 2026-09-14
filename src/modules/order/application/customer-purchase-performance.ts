/** All eligible orders, independent of the order-history cursor. No recipient/profile data. */
export interface CustomerPurchasePerformance {
  readEligibleSpend(customerId: string): Promise<number>;
}
