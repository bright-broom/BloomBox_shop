export type CustomerOrder = Readonly<{
  id: string; name: string; orderedAt: string; totalYen: number;
  payment: string; fulfillment: string; cancelled: boolean;
}>;
export type CustomerAccount = Readonly<{
  name: string; email: string | null; orders: readonly CustomerOrder[]; nextCursor: string | null;
}>;
export interface CustomerAccountReader { read(after: string | null): Promise<CustomerAccount> }
export class CustomerLoginRequiredError extends Error {
  constructor() { super("Customer login required"); this.name = "CustomerLoginRequiredError"; }
}
export class CustomerAccountUnavailableError extends Error {
  constructor() { super("Customer account unavailable"); this.name = "CustomerAccountUnavailableError"; }
}
