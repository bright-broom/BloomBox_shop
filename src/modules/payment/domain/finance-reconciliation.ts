export type FinancePayment = { id: string; externalId: string; currency: string; captured: number; refunded: number; ledgerCaptured: number; ledgerRefunded: number; ledgerImbalanced: boolean };
export type FinanceRefund = { id: string; paymentId: string | null; currency: string; amount: number; status: string };
export type FinanceDispute = { id: string; paymentId: string | null; status: string; dueAt: string | null };
export type LocalFinanceSnapshot = { payments: FinancePayment[]; refunds: FinanceRefund[]; disputes: FinanceDispute[]; orphanLedgerIds?: string[] };
export type FinanceCharge = { id: string; paymentId: string | null; currency: string; captured: number; balanceId: string | null };
export type FinanceBalance = { id: string; currency: string; amount: number; fee: number; net: number; status: string; type: string };
export type FinancePayout = { id: string; currency: string; amount: number; status: string; arrivalAt: string; balanceId: string | null };
export type ProviderFinanceSnapshot = { charges: FinanceCharge[]; refunds: FinanceRefund[]; disputes: FinanceDispute[]; balances: FinanceBalance[]; payouts: FinancePayout[] };
export type FinanceFinding = { code: string; reference: string; expected?: number | string; actual?: number | string };

// Money remains integer minor units; aggregates must never silently lose precision.
function add(a: number, b: number): number {
  const total = a + b;
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(total)) throw new Error("Finance amount exceeds safe integer range");
  return total;
}
const sum = (values: number[]) => values.reduce(add, 0);
const openDispute = (status: string) => !["won", "lost", "closed", "warning_closed"].includes(status.toLowerCase());
const pendingRefund = (status: string) => !["succeeded", "failed", "canceled", "cancelled"].includes(status.toLowerCase());
const refundStatuses: Readonly<Record<string, string>> = { REQUESTED: "pending", PROCESSING: "pending", CANCELLED: "canceled" };
const refundStatus = (status: string) => refundStatuses[status] ?? status.toLowerCase();

function byPayment<T extends { paymentId: string | null }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.paymentId) continue;
    const group = grouped.get(row.paymentId) ?? [];
    group.push(row); grouped.set(row.paymentId, group);
  }
  return grouped;
}

export function reconcileFinance(local: LocalFinanceSnapshot, provider: ProviderFinanceSnapshot) {
  const findings: FinanceFinding[] = [];
  const finding = (code: string, reference: string, expected?: number | string, actual?: number | string) => findings.push({ code, reference, ...(expected === undefined ? {} : { expected, actual }) });
  const compare = (code: string, reference: string, expected: number | string, actual: number | string) => { if (expected !== actual) finding(code, reference, expected, actual); };
  for (const id of local.orphanLedgerIds ?? []) finding("ORPHAN_LEDGER_TRANSACTION", id);
  const payments = new Map(local.payments.map((p) => [p.externalId, p]));
  const charges = new Map<string, FinanceCharge[]>();
  const balancesById = new Map(provider.balances.map((b) => [b.id, b]));
  const successfulProviderRefunds = byPayment(provider.refunds.filter((r) => r.status === "succeeded"));
  const successfulLocalRefunds = byPayment(local.refunds.filter((r) => r.status === "SUCCEEDED"));
  for (const charge of provider.charges) {
    if (charge.captured === 0) continue;
    if (!charge.paymentId || !payments.has(charge.paymentId)) finding("PROVIDER_PAYMENT_MISSING", charge.id);
    if (charge.paymentId) charges.set(charge.paymentId, [...(charges.get(charge.paymentId) ?? []), charge]);
    if (!charge.balanceId || !balancesById.has(charge.balanceId)) finding("FEES_UNVERIFIED", charge.id);
  }
  for (const payment of local.payments) {
    const related = charges.get(payment.externalId) ?? [];
    const refunds = successfulProviderRefunds.get(payment.externalId) ?? [];
    if (related.some((c) => c.currency !== payment.currency) || refunds.some((r) => r.currency !== payment.currency)) finding("CURRENCY_MISMATCH", payment.externalId);
    compare("CAPTURE_TOTAL_MISMATCH", payment.externalId, payment.captured, sum(related.filter((c) => c.currency === payment.currency).map((c) => c.captured)));
    compare("REFUND_TOTAL_MISMATCH", payment.externalId, payment.refunded, sum(refunds.filter((r) => r.currency === payment.currency).map((r) => r.amount)));
    compare("LEDGER_CAPTURE_MISMATCH", payment.externalId, payment.captured, payment.ledgerCaptured);
    compare("LEDGER_REFUND_MISMATCH", payment.externalId, payment.refunded, payment.ledgerRefunded);
    const localRefunds = successfulLocalRefunds.get(payment.externalId) ?? [];
    if (localRefunds.some((r) => r.currency !== payment.currency)) finding("CURRENCY_MISMATCH", payment.externalId);
    compare("LOCAL_REFUND_TOTAL_MISMATCH", payment.externalId, payment.refunded, sum(localRefunds.map((r) => r.amount)));
    if (payment.ledgerImbalanced) finding("LEDGER_UNBALANCED", payment.externalId);
  }
  const localRefunds = new Map(local.refunds.map((r) => [r.id, r]));
  const providerRefunds = new Map(provider.refunds.map((r) => [r.id, r]));
  for (const id of new Set([...localRefunds.keys(), ...providerRefunds.keys()])) {
    const saved = localRefunds.get(id), live = providerRefunds.get(id);
    if (!saved || !live) finding("REFUND_RECORD_MISSING", id, saved ? "Stripe record" : "BloomBox record", "missing");
    if (saved && live) {
      compare("REFUND_STATUS_MISMATCH", id, refundStatus(saved.status), refundStatus(live.status));
      compare("REFUND_AMOUNT_MISMATCH", id, saved.amount, live.amount);
      compare("CURRENCY_MISMATCH", id, saved.currency, live.currency);
      compare("REFUND_PAYMENT_MISMATCH", id, saved.paymentId ?? "missing", live.paymentId ?? "missing");
    }
    if ([saved, live].some((r) => r && pendingRefund(r.status))) finding("REFUNDS_NOT_SETTLED", id);
    if (live?.status === "failed") finding("REFUND_FAILED", id);
  }
  const disputes = [...local.disputes, ...provider.disputes].filter((d) => openDispute(d.status));
  for (const id of new Set(disputes.map((d) => d.id))) finding("OPEN_DISPUTES", id);
  const balanceSummary = new Map<string, { currency: string; type: string; status: string; amount: number; fee: number; net: number; count: number }>();
  for (const balance of provider.balances) {
    compare("BALANCE_NET_MISMATCH", balance.id, add(balance.amount, -balance.fee), balance.net);
    const key = `${balance.currency}:${balance.type}:${balance.status}`;
    const group = balanceSummary.get(key) ?? { currency: balance.currency, type: balance.type, status: balance.status, amount: 0, fee: 0, net: 0, count: 0 };
    group.amount = add(group.amount, balance.amount); group.fee = add(group.fee, balance.fee); group.net = add(group.net, balance.net); group.count++;
    balanceSummary.set(key, group);
  }
  for (const payout of provider.payouts) {
    if (payout.status !== "paid") finding("PAYOUT_NOT_PAID", payout.id, "paid", payout.status);
    const balance = payout.balanceId ? balancesById.get(payout.balanceId) : undefined;
    if (!balance) finding("PAYOUT_BALANCE_UNVERIFIED", payout.id);
    else { compare("PAYOUT_CURRENCY_MISMATCH", payout.id, payout.currency, balance.currency); compare("PAYOUT_AMOUNT_MISMATCH", payout.id, -payout.amount, balance.amount); }
  }
  const currencies = [...new Set(local.payments.map((p) => p.currency))].sort();
  return {
    status: findings.length ? "NEEDS_REVIEW" as const : "MATCHED" as const,
    findings,
    totals: currencies.map((currency) => {
      const rows = local.payments.filter((p) => p.currency === currency);
      const captured = sum(rows.map((p) => p.captured)), refunded = sum(rows.map((p) => p.refunded));
      return { currency, payments: rows.length, captured, refunded, netBeforeFees: add(captured, -refunded), ledgerCaptured: sum(rows.map((p) => p.ledgerCaptured)), ledgerRefunded: sum(rows.map((p) => p.ledgerRefunded)) };
    }),
    balanceSummary: [...balanceSummary.values()],
    openDisputes: disputes,
    payouts: provider.payouts.map((p) => ({ id: p.id, currency: p.currency, amount: p.amount, status: p.status, arrivalAt: p.arrivalAt, bankReceipt: "UNVERIFIED" as const })),
    bankReconciliation: "NOT_PERFORMED" as const,
  };
}
