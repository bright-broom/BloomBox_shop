import type { FulfillmentStatus } from "../domain/fulfillment-status";
import type {
  NativeCarrierCode,
  NativeFulfillmentAction,
  NativeFulfillmentCommand,
  NativeFulfillmentFacts,
  NativeShipmentEffect,
} from "../domain/native-fulfillment";

// Native fulfillment application contract. ADR 0015. Changes are coordinated through the #124 lead.
export const NATIVE_FULFILLMENT_PAGE_SIZE = 30;
export const NATIVE_FULFILLMENT_HISTORY_LIMIT = 50;

export type NativeFulfillmentActor = Readonly<{ operatorId: string; expiresAt: Date }>;

export type NativeShipment = Readonly<{
  carrier: NativeCarrierCode; trackingNumber: string; shippedAt: string; deliveredAt: string | null;
}>;

/** Shipping destination only. Buyer contact data and gift text are never part of this view. */
export type NativeFulfillmentDestination = Readonly<{
  name: string; postalCode: string; prefecture: string; city: string; line1: string; line2: string | null;
}>;

export type NativeFulfillmentSummary = Readonly<{
  fulfillmentId: string; version: number; status: FulfillmentStatus;
  orderId: string; orderDisplayId: string; orderedAt: string; deliveryDate: string;
  orderStatus: NativeFulfillmentFacts["orderStatus"];
  /** The single payment status, or "UNKNOWN" when the order has none or several. */
  paymentStatus: string;
  items: ReadonlyArray<Readonly<{ name: string; quantity: number }>>;
  shipment: NativeShipment | null;
}>;

export type NativeFulfillmentHistoryEntry = Readonly<{
  action: NativeFulfillmentAction; fromStatus: FulfillmentStatus; toStatus: FulfillmentStatus;
  version: number; operatorId: string; reason: string | null; occurredAt: string;
}>;

export type NativeFulfillmentDetail = NativeFulfillmentSummary & Readonly<{
  /** null when the stored destination cannot be decrypted or parsed. */
  destination: NativeFulfillmentDestination | null;
  /** Newest first, at most NATIVE_FULFILLMENT_HISTORY_LIMIT entries. */
  history: readonly NativeFulfillmentHistoryEntry[];
}>;

export type NativeFulfillmentListQuery = Readonly<{ status: FulfillmentStatus | null; after: string | null }>;
export type NativeFulfillmentPage = Readonly<{ items: readonly NativeFulfillmentSummary[]; next: string | null }>;

export type NativeFulfillmentChange = Readonly<{
  command: NativeFulfillmentCommand; fromStatus: FulfillmentStatus; toStatus: FulfillmentStatus; shipment: NativeShipmentEffect;
}>;
export type NativeFulfillmentReceipt = Readonly<{ fulfillmentId: string; status: FulfillmentStatus; version: number; replayed: boolean }>;
/** A previously stored command and the state it produced. */
export type NativeFulfillmentRecordedChange = Readonly<{ command: NativeFulfillmentCommand; status: FulfillmentStatus; version: number }>;

/**
 * Bound to one database transaction opened by the operator authorization wrapper.
 * Native means orders.commerce_provider = 'STRIPE'; any other fulfillment behaves as not found.
 */
export interface NativeFulfillmentStore {
  /** Ordered by delivery date, then fulfillment ID. `after` is the opaque cursor from a previous page. */
  list(query: NativeFulfillmentListQuery): Promise<NativeFulfillmentPage>;
  /** Records the destination access before returning. Throws UNAVAILABLE when the access cannot be recorded. */
  read(fulfillmentId: string, actor: NativeFulfillmentActor): Promise<NativeFulfillmentDetail | null>;
  /** Locks the fulfillment FOR UPDATE and its order and payments FOR SHARE. */
  lockFacts(fulfillmentId: string): Promise<NativeFulfillmentFacts | null>;
  findChange(operatorId: string, requestId: string): Promise<NativeFulfillmentRecordedChange | null>;
  /** Atomically stores status, version + 1, the shipment effect, the change log and a status transition. */
  record(change: NativeFulfillmentChange, actor: NativeFulfillmentActor): Promise<Omit<NativeFulfillmentReceipt, "replayed">>;
}
