export { SUPPORT_ORDER_PAGE_SIZE } from "../domain/order";
export type SupportOrder = Readonly<{ id: string; name: string; orderedAt: string; totalYen: number;
  status: string; payment: readonly string[]; fulfillment: readonly string[] }>;
export interface SupportOrderHistory {
  findCustomer(orderReference: string): Promise<string | null>;
  read(customerId: string, after?: string): Promise<Readonly<{ orders: readonly SupportOrder[]; next: string | null }>>;
}
