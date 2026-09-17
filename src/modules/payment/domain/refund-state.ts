export type RefundStatus = "REQUESTED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export class InvalidRefundTransitionError extends Error {
  constructor() { super("Refund provider state is inconsistent"); this.name = "InvalidRefundTransitionError"; }
}

/** Failed/cancelled refunds cannot subsequently succeed. Same-second delivery is unordered. */
export function resolveRefundState(current: RefundStatus, currentAt: Date, incoming: RefundStatus, incomingAt: Date): RefundStatus {
  const previous = currentAt.getTime(), next = incomingAt.getTime();
  if (!Number.isFinite(previous) || !Number.isFinite(next)) throw new InvalidRefundTransitionError();
  if (incoming === current || next < previous) return current;
  const finalFailure = (status: RefundStatus) => status === "FAILED" || status === "CANCELLED";
  if (next === previous) {
    if (finalFailure(current)) return current;
    if (current === "SUCCEEDED" && incoming === "CANCELLED") throw new InvalidRefundTransitionError();
    if (finalFailure(incoming)) return incoming;
    return current === "SUCCEEDED" ? current : incoming;
  }
  if (finalFailure(current) || (current === "SUCCEEDED" && incoming !== "FAILED")) throw new InvalidRefundTransitionError();
  return incoming;
}

/** Derived only after verified refund facts are resolved under the payment row lock. */
export function paymentStatusAfterRefund(captured: number, refunded: number, hasOpenDispute: boolean) {
  if (!Number.isSafeInteger(captured) || !Number.isSafeInteger(refunded) || captured <= 0 || refunded < 0 || refunded > captured) {
    throw new InvalidRefundTransitionError();
  }
  return hasOpenDispute ? "DISPUTED" : refunded === 0 ? "CAPTURED" : refunded === captured ? "REFUNDED" : "PARTIALLY_REFUNDED";
}
