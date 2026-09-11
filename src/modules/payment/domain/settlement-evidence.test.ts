import { describe, expect, it } from "vitest";
import { evaluateSettlement, reconcileSettlement, SettlementEvidenceConflictError, type SettlementSnapshot, type SettlementTransaction } from "./settlement-evidence";
const tx = (id: string, kind: SettlementTransaction["kind"], amount: number, parentId: string | null = null, status: SettlementTransaction["status"] = "SUCCEEDED"): SettlementTransaction => ({ id, kind, amount, parentId, status });
const snapshot = (transactions: readonly SettlementTransaction[] = [], received = 0, refunded = 0): SettlementSnapshot => ({ updatedAt: "2026-09-11T10:00:00Z", cancelledAt: null, test: true, requested: 4000, received, refunded, transactions });
describe("settlement evidence", () => {
  it.each([
    [snapshot(), "PROCESSING"],
    [snapshot([tx("sale", "SALE", 4000, null, "FAILED")]), "PROCESSING"],
    [snapshot([tx("auth", "AUTHORIZATION", 4000)]), "AUTHORIZED"],
    [snapshot([tx("sale", "SALE", 2000)], 2000), "PARTIALLY_PAID"],
    [snapshot([tx("sale", "SALE", 4000)], 4000), "CAPTURED"],
    [snapshot([tx("sale", "SALE", 4000), tx("refund", "REFUND", 500, "sale")], 4000, 500), "PARTIALLY_REFUNDED"],
    [snapshot([tx("sale", "SALE", 4000), tx("refund", "REFUND", 4000, "sale")], 4000, 4000), "REFUNDED"],
    [snapshot([tx("auth", "AUTHORIZATION", 4000), tx("void", "VOID", 4000, "auth")]), "CANCELLED"],
  ] as const)("derives %s without trusting display labels", (value, status) => {
    expect(evaluateSettlement(value).status).toBe(status);
  });
  it("does not count failed/pending refunds or order cancellation as refunded money", () => {
    const value = snapshot([tx("sale", "SALE", 4000), tx("r1", "REFUND", 500, "sale", "PENDING"), tx("r2", "REFUND", 500, "sale", "FAILED")], 4000);
    expect(evaluateSettlement({ ...value, cancelledAt: value.updatedAt })).toMatchObject({ status: "CAPTURED", refunded: 0 });
  });
  it("counts partial captures once and retains remaining authorization", () => {
    const value = snapshot([tx("a", "AUTHORIZATION", 4000), tx("c", "CAPTURE", 1500, "a")], 1500);
    expect(evaluateSettlement(value)).toMatchObject({ status: "PARTIALLY_PAID", captured: 1500, authorized: 2500 });
  });
  it.each([
    snapshot([tx("s", "SALE", 4000)], 3999),
    snapshot([tx("s", "SALE", 4000), tx("r", "REFUND", 500, "s")], 4000, 0),
    snapshot([tx("s", "SALE", 4000), tx("r", "REFUND", 5000, "s")], 4000, 5000),
    snapshot([tx("s", "SALE", 4001)], 4001),
    snapshot([tx("c", "CAPTURE", 4000)], 4000),
    snapshot([tx("s", "SALE", 4000), tx("r", "REFUND", 100, "missing")], 4000, 100),
    snapshot([tx("a", "AUTHORIZATION", 4000), tx("v", "VOID", 4000, "a"), tx("c", "CAPTURE", 4000, "a")], 4000),
    snapshot([tx("s", "SALE", 4000), tx("s", "SALE", 4000)], 4000),
    snapshot([tx("other", "UNSUPPORTED", 0)]),
    { ...snapshot(), requested: 0 }, { ...snapshot(), received: Number.MAX_SAFE_INTEGER + 1 },
  ])("holds contradictory or unsupported money facts", (value) => {
    expect(() => evaluateSettlement(value)).toThrow(SettlementEvidenceConflictError);
  });
  it("ignores an older subset but rejects new successes hidden behind an older timestamp", () => {
    const paid = snapshot([tx("s", "SALE", 4000)], 4000);
    const partial = { ...snapshot([...paid.transactions, tx("r", "REFUND", 500, "s")], 4000, 500), updatedAt: "2026-09-11T11:00:00Z" };
    expect(reconcileSettlement(evaluateSettlement(partial), paid).outcome).toBe("STALE");
    expect(() => reconcileSettlement(evaluateSettlement(paid), { ...partial, updatedAt: "2026-09-10T11:00:00Z" })).toThrow(SettlementEvidenceConflictError);
  });
  it("handles same-time transaction progress and canonical duplicate order", () => {
    const paid = snapshot([tx("s", "SALE", 4000), tx("r", "REFUND", 500, "s", "PENDING")], 4000);
    const partial = snapshot([tx("r", "REFUND", 500, "s"), tx("s", "SALE", 4000)], 4000, 500);
    const result = reconcileSettlement(evaluateSettlement(paid), partial);
    expect(result).toMatchObject({ outcome: "APPLIED", evidence: { status: "PARTIALLY_REFUNDED" } });
    expect(reconcileSettlement(result.evidence, { ...partial, updatedAt: "2026-09-11T19:00:00+09:00", transactions: [...partial.transactions].reverse() }).outcome).toBe("DUPLICATE");
    expect(() => reconcileSettlement(result.evidence, paid)).toThrow(SettlementEvidenceConflictError);
  });
  it("rejects transaction identity changes, lost transactions, and mode switches", () => {
    const value = snapshot([tx("s", "SALE", 4000, null, "PENDING")]);
    const previous = evaluateSettlement(value);
    for (const next of [snapshot([tx("s", "SALE", 3999, null, "PENDING")]), snapshot(), { ...value, test: false }]) {
      expect(() => reconcileSettlement(previous, next)).toThrow(SettlementEvidenceConflictError);
    }
  });
  it("observes a later actual payment after a void without equating order cancellation with cash", () => {
    const cancelled = { ...snapshot([tx("a", "AUTHORIZATION", 4000), tx("v", "VOID", 4000, "a")]), cancelledAt: "2026-09-11T09:00:00Z" };
    const paid = { ...cancelled, received: 4000, transactions: [...cancelled.transactions, tx("s", "SALE", 4000)] };
    expect(reconcileSettlement(evaluateSettlement(cancelled), paid).evidence.status).toBe("CAPTURED");
    expect(() => reconcileSettlement(evaluateSettlement(paid), { ...paid, cancelledAt: null })).toThrow(SettlementEvidenceConflictError);
  });
});
