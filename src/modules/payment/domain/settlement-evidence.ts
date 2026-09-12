export type SettlementTransaction = Readonly<{
  id: string;
  kind: "AUTHORIZATION" | "CAPTURE" | "SALE" | "REFUND" | "VOID" | "UNSUPPORTED";
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  parentId: string | null;
  amount: number;
}>;
export type SettlementSnapshot = Readonly<{
  updatedAt: string;
  cancelledAt: string | null;
  test: boolean;
  requested: number;
  received: number;
  refunded: number;
  transactions: readonly SettlementTransaction[];
}>;
export type SettlementStatus = "PROCESSING" | "AUTHORIZED" | "PARTIALLY_PAID" | "CAPTURED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "CANCELLED";
export type SettlementEvidence = Readonly<{
  snapshot: SettlementSnapshot;
  status: SettlementStatus;
  captured: number;
  refunded: number;
  authorized: number;
}>;
export class SettlementEvidenceConflictError extends Error {
  constructor() { super("Provider settlement evidence requires reconciliation"); this.name = "SettlementEvidenceConflictError"; }
}
const fail = (): never => { throw new SettlementEvidenceConflictError(); };
function sum(values: readonly number[]): number {
  const result = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(result) || result < 0) fail();
  return result;
}

/** A provider observation, not an authorization to accept/ship an order or create a refund. */
export function evaluateSettlement(snapshot: SettlementSnapshot): SettlementEvidence {
  if (!Number.isFinite(Date.parse(snapshot.updatedAt))
    || (snapshot.cancelledAt !== null && !Number.isFinite(Date.parse(snapshot.cancelledAt)))
    || !Number.isSafeInteger(snapshot.requested) || snapshot.requested <= 0
    || ![snapshot.received, snapshot.refunded].every((amount) => Number.isSafeInteger(amount) && amount >= 0)) fail();
  const transactions = [...snapshot.transactions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  if (byId.size !== transactions.length || transactions.some((transaction) => !transaction.id
    || !Number.isSafeInteger(transaction.amount) || transaction.amount < 0)) fail();
  const successful = transactions.filter((transaction) => transaction.status === "SUCCEEDED");
  if (successful.some((transaction) => transaction.kind === "UNSUPPORTED")) fail();
  for (const transaction of successful) {
    if (transaction.kind === "VOID" && transaction.amount === 0) fail();
    if (["CAPTURE", "REFUND", "VOID"].includes(transaction.kind)) {
      const parent = transaction.parentId ? byId.get(transaction.parentId) : undefined;
      if (!parent || parent.status !== "SUCCEEDED"
        || (transaction.kind === "REFUND" ? !["CAPTURE", "SALE"].includes(parent.kind) : parent.kind !== "AUTHORIZATION")) fail();
    }
    if (["SALE", "AUTHORIZATION"].includes(transaction.kind) && transaction.parentId !== null) fail();
  }
  for (const parent of successful) {
    const children = successful.filter((transaction) => transaction.parentId === parent.id);
    if (sum(children.map((transaction) => transaction.amount)) > parent.amount) fail();
  }
  const captured = sum(successful.filter((transaction) => ["CAPTURE", "SALE"].includes(transaction.kind)).map((transaction) => transaction.amount));
  const refunded = sum(successful.filter((transaction) => transaction.kind === "REFUND").map((transaction) => transaction.amount));
  const authorized = sum(successful.filter((transaction) => transaction.kind === "AUTHORIZATION").map((authorization) => {
    return authorization.amount - sum(successful.filter((transaction) => transaction.parentId === authorization.id).map((transaction) => transaction.amount));
  }));
  if (captured !== snapshot.received || refunded !== snapshot.refunded || refunded > captured
    || sum([authorized, captured]) > snapshot.requested) fail();
  let status: SettlementStatus = "PROCESSING";
  if (captured > 0) {
    status = refunded === captured ? "REFUNDED" : refunded > 0 ? "PARTIALLY_REFUNDED"
      : captured === snapshot.requested ? "CAPTURED" : "PARTIALLY_PAID";
  } else if (authorized > 0) status = "AUTHORIZED";
  else if (successful.some((transaction) => transaction.kind === "VOID")
    && !transactions.some((transaction) => transaction.status === "PENDING")) status = "CANCELLED";
  return { snapshot: { ...snapshot, updatedAt: new Date(snapshot.updatedAt).toISOString(),
    cancelledAt: snapshot.cancelledAt === null ? null : new Date(snapshot.cancelledAt).toISOString(), transactions }, status, captured, refunded, authorized };
}

export function reconcileSettlement(previous: SettlementEvidence | null, snapshot: SettlementSnapshot): Readonly<{
  outcome: "APPLIED" | "DUPLICATE" | "STALE"; evidence: SettlementEvidence;
}> {
  const next = evaluateSettlement(snapshot);
  if (!previous) return { outcome: "APPLIED", evidence: next };
  if (snapshot.test !== previous.snapshot.test || snapshot.requested !== previous.snapshot.requested) fail();
  const same = (a: SettlementTransaction, b: SettlementTransaction) => a.id === b.id && a.kind === b.kind
    && a.amount === b.amount && a.parentId === b.parentId && a.status === b.status;
  const containsSuccesses = (container: SettlementSnapshot, subset: SettlementSnapshot) => subset.transactions
    .filter((transaction) => transaction.status === "SUCCEEDED")
    .every((transaction) => container.transactions.some((candidate) => same(candidate, transaction)));
  if (Date.parse(snapshot.updatedAt) < Date.parse(previous.snapshot.updatedAt)) {
    if (!containsSuccesses(previous.snapshot, next.snapshot) || next.captured > previous.captured || next.refunded > previous.refunded
      || (next.snapshot.cancelledAt !== null && next.snapshot.cancelledAt !== previous.snapshot.cancelledAt)) fail();
    return { outcome: "STALE", evidence: previous };
  }
  for (const old of previous.snapshot.transactions) {
    const current = next.snapshot.transactions.find((transaction) => transaction.id === old.id);
    if (!current || current.kind !== old.kind || current.amount !== old.amount || current.parentId !== old.parentId) fail();
  }
  if (!containsSuccesses(next.snapshot, previous.snapshot) || next.captured < previous.captured || next.refunded < previous.refunded
    || (previous.snapshot.cancelledAt !== null && next.snapshot.cancelledAt !== previous.snapshot.cancelledAt)) fail();
  if (JSON.stringify(next) === JSON.stringify(previous)) return { outcome: "DUPLICATE", evidence: previous };
  return { outcome: "APPLIED", evidence: next };
}
