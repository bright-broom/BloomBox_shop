import type { SupportOrder } from "./support-order-history";
export const OPERATOR_ORDER_PAGE_SIZE = 20;
export const OPERATOR_ORDER_SEARCH_LIMIT = 100;
export const OPERATOR_REPORT_PERIODS = [7, 30, 90] as const;
export type OperatorOrderFilter = Readonly<{
  q?: string;
  status?: string;
  payment?: string;
  fulfillment?: string;
  after?: string;
}>;
export type OperatorOrder = SupportOrder &
  Readonly<{ customerId: string | null }>;
export type OperatorOrderPage = Readonly<{
  orders: readonly OperatorOrder[];
  next: string | null;
}>;
export type OperatorOrderReport = Readonly<{
  days: number;
  since: string;
  until: string;
  orders: number;
  orderValueYen: number;
  captured: number;
  refunds: number;
  awaitingShipment: number;
  cancelled: number;
  daily: readonly Readonly<{
    day: string;
    orders: number;
    orderValueYen: number;
  }>[];
}>;
