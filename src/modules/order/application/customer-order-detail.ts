import type { CustomerOrderSummary } from "./customer-order-history";

export type CustomerOrderDetail = CustomerOrderSummary & Readonly<{
  subtotalYen: number; taxYen: number; shippingYen: number; discountYen: number;
  items: readonly Readonly<{ name: string; quantity: number; unitYen: number; totalYen: number }>[];
}>;
export interface CustomerOrderDetailQuery {
  readDetail(customerId: string, orderId: string): Promise<CustomerOrderDetail | null>;
}
