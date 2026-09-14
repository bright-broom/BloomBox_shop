import type { Money } from "@/shared/domain/money";

export const ORDER_STATUS_POLL_LIMIT = 10;
export const ORDER_STATUS_POLL_INTERVAL_MS = 4_000;

export type OrderProgress =
  | "PROCESSING"
  | "PAYMENT_FAILED"
  | "CHECKOUT_EXPIRED"
  | "CONFIRMED"
  | "FULFILLING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "ATTENTION";

export type OrderStatusRecord = Readonly<{
  purchaseIntentId: string;
  purchaseIntentStatus: string;
  purchaseIntentDisplayId: string;
  orderDisplayId?: string;
  orderStatus?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  productId: string;
  productName: string;
  quantity: number;
  deliveryDate: string;
  total?: Money;
  carrierCode?: string;
  trackingReference?: string;
}>;

export type PublicOrderStatus = Readonly<{
  progress: OrderProgress;
  displayId: string;
  /** The checkout's purchase reference. The browser cart that started it uses the same value as its request ID. */
  purchaseIntentId: string;
  /** An order exists for this checkout, so the cart that started it must not start another purchase. */
  orderCreated: boolean;
  productId: string;
  productName: string;
  quantity: number;
  deliveryDate: string;
  total?: Money;
  carrierCode?: string;
  trackingReference?: string;
}>;

export interface OrderStatusQuery {
  findByCheckoutReference(reference: string): Promise<OrderStatusRecord | null>;
}

export class InvalidOrderTrackingReferenceError extends Error {
  constructor() {
    super("注文確認用の情報が正しくありません。");
    this.name = "InvalidOrderTrackingReferenceError";
  }
}

export class GetOrderStatus {
  constructor(private readonly query: OrderStatusQuery) {}

  async execute(reference: string): Promise<PublicOrderStatus | null> {
    if (!/^cs_(?:test_|live_)?[A-Za-z0-9]{3,220}$/.test(reference)) {
      throw new InvalidOrderTrackingReferenceError();
    }
    const record = await this.query.findByCheckoutReference(reference);
    if (!record) return null;
    return {
      progress: resolveProgress(record),
      displayId: record.orderDisplayId ?? record.purchaseIntentDisplayId,
      purchaseIntentId: record.purchaseIntentId,
      orderCreated: record.orderStatus !== undefined,
      productId: record.productId,
      productName: record.productName,
      quantity: record.quantity,
      deliveryDate: record.deliveryDate,
      total: record.total,
      carrierCode: record.carrierCode,
      trackingReference: record.trackingReference,
    };
  }
}

function resolveProgress(record: OrderStatusRecord): OrderProgress {
  if (record.purchaseIntentStatus === "ABANDONED") return "PAYMENT_FAILED";
  if (record.purchaseIntentStatus === "EXPIRED") return "CHECKOUT_EXPIRED";
  if (
    ["DISPUTED", "FAILED", "CANCELLED"].includes(record.paymentStatus ?? "")
    || record.fulfillmentStatus === "RETURNED"
  ) return "ATTENTION";
  if (record.paymentStatus === "PARTIALLY_REFUNDED") return "PARTIALLY_REFUNDED";
  if (record.paymentStatus === "REFUNDED") return "REFUNDED";
  if (record.orderStatus === "CANCELLED") return "CANCELLED";
  if (record.fulfillmentStatus === "DELIVERED") return "DELIVERED";
  if (record.fulfillmentStatus === "SHIPPED") return "SHIPPED";
  if (["SCHEDULED", "PROCESSING", "READY"].includes(record.fulfillmentStatus ?? "")) {
    return "FULFILLING";
  }
  if (record.orderStatus === "CONFIRMED") return "CONFIRMED";
  return "PROCESSING";
}
