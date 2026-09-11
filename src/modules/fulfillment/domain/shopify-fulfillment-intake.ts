import { assessDeliveryDate } from "./delivery-date";
import type { FulfillmentStatus } from "./fulfillment-status";

export type FulfillmentIntakePolicy = Readonly<{ approval: "PENDING" | "APPROVED" }>;
export const FULFILLMENT_INTAKE_POLICY: FulfillmentIntakePolicy = { approval: "PENDING" };
export type FulfillmentIntakeDecision = Readonly<{ kind: "CANCELLED" | "HELD"; reason:
  "ORDER_CANCELLED" | "FULLY_REFUNDED" | "ALREADY_CANCELLED" | "POST_SHIPMENT_REVIEW_REQUIRED"
  | "ACTIVE_FULFILLMENT_REVIEW_REQUIRED" | "ORDER_NOT_CONFIRMED" | "PARTIAL_REFUND"
  | "PAYMENT_UNSETTLED" | "PAYMENT_PENDING" | "ADDRESS_UNAVAILABLE" | "DELIVERY_UNAVAILABLE"
  | "POLICY_NOT_APPROVED" | "INVENTORY_UNVERIFIED" }>;
export type FulfillmentIntakeFacts = Readonly<{
  status: FulfillmentStatus | null; orderStatus: "PENDING_CONFIRMATION" | "CONFIRMED" | "CANCELLED" | "CLOSED";
  orderCancelled: boolean; total: number; captured: number; refunded: number; pendingTransactions: boolean;
  addressAvailable: boolean; deliveryDate: string;
}>;

/** Intake never authorizes scheduling or shipping; verified inventory/dispatch integration is still absent. */
export function assessFulfillmentIntake(facts: FulfillmentIntakeFacts, policy: FulfillmentIntakePolicy, now: Date): FulfillmentIntakeDecision {
  const cancellation = facts.orderCancelled || facts.orderStatus === "CANCELLED" ? "ORDER_CANCELLED"
    : facts.total > 0 && facts.refunded >= facts.total ? "FULLY_REFUNDED" : null;
  if (facts.status === "CANCELLED") return { kind: "CANCELLED", reason: cancellation ?? "ALREADY_CANCELLED" };
  if (facts.status && ["SHIPPED", "DELIVERED", "RETURNED"].includes(facts.status)) return { kind: "HELD", reason: "POST_SHIPMENT_REVIEW_REQUIRED" };
  if (facts.status && facts.status !== "UNFULFILLED") return { kind: "HELD", reason: "ACTIVE_FULFILLMENT_REVIEW_REQUIRED" };
  if (cancellation) return { kind: "CANCELLED", reason: cancellation };
  if (facts.orderStatus !== "CONFIRMED") return { kind: "HELD", reason: "ORDER_NOT_CONFIRMED" };
  if (facts.refunded > 0) return { kind: "HELD", reason: "PARTIAL_REFUND" };
  if (facts.total <= 0 || facts.captured !== facts.total) return { kind: "HELD", reason: "PAYMENT_UNSETTLED" };
  if (facts.pendingTransactions) return { kind: "HELD", reason: "PAYMENT_PENDING" };
  if (!facts.addressAvailable) return { kind: "HELD", reason: "ADDRESS_UNAVAILABLE" };
  if (assessDeliveryDate(facts.deliveryDate, now).status !== "WITHIN_WINDOW") return { kind: "HELD", reason: "DELIVERY_UNAVAILABLE" };
  if (policy.approval !== "APPROVED") return { kind: "HELD", reason: "POLICY_NOT_APPROVED" };
  return { kind: "HELD", reason: "INVENTORY_UNVERIFIED" };
}
