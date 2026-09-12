export type CustomerOrderSummary = Readonly<{
  id: string; name: string; orderedAt: string; totalYen: number;
  payment: string; fulfillment: string; cancelled: boolean;
}>;
export interface CustomerOrderHistoryQuery {
  read(customerId: string, after: string | null): Promise<Readonly<{ orders: readonly CustomerOrderSummary[]; nextCursor: string | null }>>;
}
export class CustomerOrderHistoryUnavailableError extends Error {
  constructor() { super("Customer order history unavailable"); this.name = "CustomerOrderHistoryUnavailableError"; }
}
