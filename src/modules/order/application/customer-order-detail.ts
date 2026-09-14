import type { CustomerOrderSummary } from "./customer-order-history";

/** Shown only when the order has exactly one fulfillment with exactly one shipment record (ADR 0015). */
export type CustomerOrderShipment = Readonly<{ carrier: string; trackingNumber: string; shippedAt: string; deliveredAt: string | null }>;
export type CustomerOrderDetail = Omit<CustomerOrderSummary, "items"> & Readonly<{
  subtotalYen: number; taxYen: number; shippingYen: number; discountYen: number;
  items: readonly Readonly<{ name: string; quantity: number; unitYen: number; totalYen: number }>[];
  shipment: CustomerOrderShipment | null;
}>;
export interface CustomerOrderDetailQuery {
  readDetail(customerId: string, orderId: string): Promise<CustomerOrderDetail | null>;
}
