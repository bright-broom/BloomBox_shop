import { describe, expect, it } from "vitest";
import { InvalidRefundTransitionError, paymentStatusAfterRefund, resolveRefundState, type RefundStatus } from "./refund-state";
const early = new Date("2026-09-17T00:00:00Z"), late = new Date("2026-09-17T00:01:00Z");
describe("verified refund correction", () => {
  it("corrects success after a later bank failure", () => {
    expect(resolveRefundState("SUCCEEDED", early, "FAILED", late)).toBe("FAILED");
  });
  it.each(["SUCCEEDED", "PROCESSING"] as const)("keeps late old %s events from reopening failed refunds", (status) => {
    expect(resolveRefundState("FAILED", late, status, early)).toBe("FAILED");
  });
  it("converges on failure for same-second success/failure in either arrival order", () => {
    expect(resolveRefundState("SUCCEEDED", early, "FAILED", early)).toBe("FAILED");
    expect(resolveRefundState("FAILED", early, "SUCCEEDED", early)).toBe("FAILED");
  });
  it.each(["SUCCEEDED", "PROCESSING", "CANCELLED"] satisfies RefundStatus[])("rejects newer %s after terminal failure", (status) => {
    expect(() => resolveRefundState("FAILED", early, status, late)).toThrow(InvalidRefundTransitionError);
  });
  it.each(["PROCESSING", "CANCELLED"] satisfies RefundStatus[])("does not infer unsupported success to %s corrections", (status) => {
    expect(() => resolveRefundState("SUCCEEDED", early, status, late)).toThrow(InvalidRefundTransitionError);
  });
  it("derives partial/full/restored payment totals without erasing a dispute", () => {
    expect(paymentStatusAfterRefund(5000, 0, false)).toBe("CAPTURED");
    expect(paymentStatusAfterRefund(5000, 1000, false)).toBe("PARTIALLY_REFUNDED");
    expect(paymentStatusAfterRefund(5000, 5000, false)).toBe("REFUNDED");
    expect(paymentStatusAfterRefund(5000, 0, true)).toBe("DISPUTED");
    expect(() => paymentStatusAfterRefund(5000, 5001, false)).toThrow(InvalidRefundTransitionError);
  });
});
