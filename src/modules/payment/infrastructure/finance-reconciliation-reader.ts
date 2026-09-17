import { z } from "zod";
import type Stripe from "stripe";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { LocalFinanceSnapshot, ProviderFinanceSnapshot } from "../domain/finance-reconciliation";

export const FINANCE_MAX_RECORDS = 10_000;
const id = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200);
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const money = integer.nonnegative();
const currency = z.string().regex(/^[A-Za-z]{3}$/).transform((s) => s.toUpperCase());
const dbAmount = z.string().regex(/^-?\d+$/).transform(Number).pipe(integer);
const payment = z.object({ id, externalId: id, currency, captured: dbAmount, refunded: dbAmount, ledgerCaptured: dbAmount, ledgerRefunded: dbAmount, ledgerImbalanced: z.boolean() });
const refund = z.object({ id, paymentId: id.nullable(), currency, amount: dbAmount, status: z.enum(["REQUESTED", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"]) });
const dispute = z.object({ id, paymentId: id.nullable(), status: z.enum(["NEEDS_RESPONSE", "UNDER_REVIEW", "WON", "LOST", "CLOSED"]), dueAt: z.string().nullable() });

export async function readLocalFinance(sql: DatabaseClient): Promise<LocalFinanceSnapshot> {
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    await tx`SET LOCAL statement_timeout = '30s'`;
    const payments = await tx`
      SELECT p.id, p.external_payment_id AS "externalId", p.currency,
        p.amount_captured_minor::text AS captured, p.amount_refunded_minor::text AS refunded,
        COALESCE((SELECT sum(e.signed_amount_minor) FROM bloombox.financial_transactions f
          JOIN bloombox.ledger_entries e ON e.financial_transaction_id=f.id
          WHERE f.payment_id=p.id AND f.transaction_type='CAPTURE' AND e.account_code='STRIPE_CLEARING'),0)::text AS "ledgerCaptured",
        COALESCE((SELECT -sum(e.signed_amount_minor) FROM bloombox.financial_transactions f
          JOIN bloombox.ledger_entries e ON e.financial_transaction_id=f.id
          WHERE f.payment_id=p.id AND f.transaction_type='REFUND' AND e.account_code='STRIPE_CLEARING'),0)::text AS "ledgerRefunded",
        EXISTS(SELECT f.id FROM bloombox.financial_transactions f LEFT JOIN bloombox.ledger_entries e ON e.financial_transaction_id=f.id
          WHERE f.payment_id=p.id GROUP BY f.id
          HAVING count(e.id)<2 OR sum(e.signed_amount_minor)<>0 OR count(DISTINCT e.currency)<>1
            OR bool_or(e.currency<>f.currency) OR bool_or(f.currency<>p.currency)) AS "ledgerImbalanced"
      FROM bloombox.payments p WHERE p.commerce_provider='STRIPE' ORDER BY p.id LIMIT ${FINANCE_MAX_RECORDS + 1}`;
    const refunds = await tx`
      SELECT r.external_refund_id AS id, p.external_payment_id AS "paymentId", r.currency, r.amount_minor::text AS amount, r.status
      FROM bloombox.refunds r JOIN bloombox.payments p ON p.id=r.payment_id
      WHERE r.commerce_provider='STRIPE' AND p.commerce_provider='STRIPE' ORDER BY r.id LIMIT ${FINANCE_MAX_RECORDS + 1}`;
    const disputes = await tx`
      SELECT d.external_dispute_id AS id, p.external_payment_id AS "paymentId", d.status, d.due_at::text AS "dueAt"
      FROM bloombox.disputes d JOIN bloombox.payments p ON p.id=d.payment_id
      WHERE d.commerce_provider='STRIPE' AND p.commerce_provider='STRIPE' ORDER BY d.id LIMIT ${FINANCE_MAX_RECORDS + 1}`;
    const orphanLedger = await tx`
      SELECT f.id FROM bloombox.financial_transactions f LEFT JOIN bloombox.payments p ON p.id=f.payment_id
      WHERE (p.id IS NULL OR p.commerce_provider<>'STRIPE')
        AND EXISTS(SELECT 1 FROM bloombox.ledger_entries e WHERE e.financial_transaction_id=f.id AND e.account_code='STRIPE_CLEARING')
      ORDER BY f.id LIMIT ${FINANCE_MAX_RECORDS + 1}`;
    return {
      orphanLedgerIds: z.array(z.object({ id })).max(FINANCE_MAX_RECORDS).parse(orphanLedger).map((r) => r.id),
      payments: z.array(payment).max(FINANCE_MAX_RECORDS).parse(payments),
      refunds: z.array(refund).max(FINANCE_MAX_RECORDS).parse(refunds),
      disputes: z.array(dispute).max(FINANCE_MAX_RECORDS).parse(disputes),
    };
  });
}

type PageParameters = { limit: number; starting_after?: string };
type Page = { data: unknown[]; has_more: boolean };
export async function readFinancePages<T extends { id: string }>(fetchPage: (parameters: PageParameters) => Promise<Page>, schema: z.ZodType<T>): Promise<T[]> {
  const result: T[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < FINANCE_MAX_RECORDS / 100; pageNumber++) {
    const page = z.object({ data: z.array(z.unknown()).max(100), has_more: z.boolean() }).parse(await fetchPage({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) }));
    for (const item of page.data) {
      const parsed = schema.parse(item);
      if (seen.has(parsed.id)) throw new Error("Finance pagination returned duplicate identifiers");
      seen.add(parsed.id); result.push(parsed); cursor = parsed.id;
    }
    if (!page.has_more) return result;
    if (!page.data.length) throw new Error("Finance pagination did not advance");
  }
  throw new Error("Finance report exceeded the complete snapshot limit");
}

export async function readProviderFinance(stripe: Stripe, mode: "test" | "live", accountId: string, apiVersion: string): Promise<ProviderFinanceSnapshot> {
  const requestOptions = { apiVersion };
  const account = await stripe.accounts.retrieveCurrent({}, requestOptions);
  if (account.id !== accountId) throw new Error("Finance provider account mismatch");
  const livemode = z.literal(mode === "live");
  const chargeSchema = z.object({ id, payment_intent: id.nullable(), currency, amount_captured: money, paid: z.boolean(), livemode, balance_transaction: id.nullable() });
  const refundSchema = z.object({ id, payment_intent: id.nullable(), currency, amount: money, status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]), });
  // Refund and balance transaction objects have no livemode field; the scoped key and verified account define their mode.
  const disputeSchema = z.object({ id, payment_intent: id.nullable(), status: z.enum(["warning_needs_response", "warning_under_review", "warning_closed", "needs_response", "under_review", "won", "lost"]), livemode, evidence_details: z.object({ due_by: money.nullable() }) });
  const balanceSchema = z.object({ id, currency, amount: integer, fee: integer, net: integer, status: z.enum(["available", "pending"]), type: z.string().regex(/^[a-z_]+$/).max(80) });
  const payoutSchema = z.object({ id, currency, amount: money, status: z.enum(["paid", "pending", "in_transit", "canceled", "failed"]), arrival_date: money, balance_transaction: id.nullable(), livemode });
  const charges = await readFinancePages((p) => stripe.charges.list(p, requestOptions), chargeSchema);
  const refunds = await readFinancePages((p) => stripe.refunds.list(p, requestOptions), refundSchema);
  const disputes = await readFinancePages((p) => stripe.disputes.list(p, requestOptions), disputeSchema);
  const balances = await readFinancePages((p) => stripe.balanceTransactions.list(p, requestOptions), balanceSchema);
  const payouts = await readFinancePages((p) => stripe.payouts.list(p, requestOptions), payoutSchema);
  return {
    charges: charges.filter((c) => c.paid).map((c) => ({ id: c.id, paymentId: c.payment_intent, currency: c.currency, captured: c.amount_captured, balanceId: c.balance_transaction })),
    refunds: refunds.map((r) => ({ id: r.id, paymentId: r.payment_intent, currency: r.currency, amount: r.amount, status: r.status })),
    disputes: disputes.map((d) => ({ id: d.id, paymentId: d.payment_intent, status: d.status, dueAt: d.evidence_details.due_by === null ? null : new Date(d.evidence_details.due_by * 1000).toISOString() })),
    balances,
    payouts: payouts.map((p) => ({ id: p.id, currency: p.currency, amount: p.amount, status: p.status, arrivalAt: new Date(p.arrival_date * 1000).toISOString(), balanceId: p.balance_transaction })),
  };
}
