import { describe, expect, it } from "vitest";
import { reconcileFinance, type LocalFinanceSnapshot, type ProviderFinanceSnapshot } from "./finance-reconciliation";
function fixture(): { local: LocalFinanceSnapshot; provider: ProviderFinanceSnapshot } {
  return {
    local: { payments: [{id:"local1",externalId:"pi_1",currency:"JPY",captured:5000,refunded:1000,ledgerCaptured:5000,ledgerRefunded:1000,ledgerImbalanced:false}],
      refunds:[{id:"re_1",paymentId:"pi_1",currency:"JPY",amount:1000,status:"SUCCEEDED"}], disputes:[] },
    provider: { charges:[{id:"ch_1",paymentId:"pi_1",currency:"JPY",captured:5000,balanceId:"txn_1"}],
      refunds:[{id:"re_1",paymentId:"pi_1",currency:"JPY",amount:1000,status:"succeeded"}],disputes:[],
      balances:[{id:"txn_1",currency:"JPY",amount:5000,fee:180,net:4820,status:"available",type:"charge"}],payouts:[] },
  };
}
const codes = (result: ReturnType<typeof reconcileFinance>) => result.findings.map((f) => f.code);
describe("read-only finance reconciliation", () => {
  it("matches payments/refunds/ledger and keeps settlement currency fees separate", () => {
    const {local,provider}=fixture(), before=JSON.stringify({local,provider});
    const report=reconcileFinance(local,provider);
    expect(report.status).toBe("MATCHED");expect(report.totals[0]).toMatchObject({captured:5000,refunded:1000,netBeforeFees:4000});
    expect(report.balanceSummary[0]).toMatchObject({currency:"JPY",fee:180,net:4820});
    expect(report.bankReconciliation).toBe("NOT_PERFORMED");expect(JSON.stringify({local,provider})).toBe(before);
  });
  it("detects captured, refunded, ledger and balance discrepancies", () => {
    const {local,provider}=fixture();local.payments[0].captured=6000;local.payments[0].refunded=2000;local.payments[0].ledgerImbalanced=true;local.orphanLedgerIds=["orphan"];provider.balances[0].net=1;
    expect(codes(reconcileFinance(local,provider))).toEqual(expect.arrayContaining(["CAPTURE_TOTAL_MISMATCH","REFUND_TOTAL_MISMATCH","LEDGER_CAPTURE_MISMATCH","LEDGER_REFUND_MISMATCH","LOCAL_REFUND_TOTAL_MISMATCH","LEDGER_UNBALANCED","ORPHAN_LEDGER_TRANSACTION","BALANCE_NET_MISMATCH"]));
  });
  it("detects successful refunds subsequently failed at Stripe without changing facts", () => {
    const {local,provider}=fixture();provider.refunds[0].status="failed";
    expect(codes(reconcileFinance(local,provider))).toEqual(expect.arrayContaining(["REFUND_STATUS_MISMATCH","REFUND_TOTAL_MISMATCH","REFUND_FAILED"]));
    expect(local.refunds[0].status).toBe("SUCCEEDED");
  });
  it("reports pending refunds and open disputes from either source", () => {
    const {local,provider}=fixture();provider.refunds[0].status="pending";
    local.disputes=[{id:"dp_local",paymentId:"pi_1",status:"NEEDS_RESPONSE",dueAt:"2026-09-18"}];
    provider.disputes=[{id:"dp_remote",paymentId:"pi_1",status:"under_review",dueAt:null},{id:"dp_closed",paymentId:"pi_1",status:"won",dueAt:null}];
    const result=reconcileFinance(local,provider);
    expect(codes(result)).toContain("REFUNDS_NOT_SETTLED");expect(result.openDisputes.map((d)=>d.id)).toEqual(["dp_local","dp_remote"]);
  });
  it("reports records missing on either side, foreign payments and unknown fees", () => {
    const {local,provider}=fixture();provider.refunds[0].id="re_foreign";provider.charges[0].paymentId="pi_missing";provider.charges[0].balanceId=null;
    const report=reconcileFinance(local,provider);
    expect(codes(report).filter((c)=>c==="REFUND_RECORD_MISSING")).toHaveLength(2);
    expect(codes(report)).toEqual(expect.arrayContaining(["PROVIDER_PAYMENT_MISSING","FEES_UNVERIFIED"]));
  });
  it("does not compare or aggregate different currencies as if equal", () => {
    const {local,provider}=fixture();provider.charges[0].currency="USD";
    provider.balances.push({id:"txn_usd",currency:"USD",amount:300,fee:15,net:285,status:"pending",type:"charge"});
    const report=reconcileFinance(local,provider);
    expect(codes(report)).toContain("CURRENCY_MISMATCH");expect(report.balanceSummary.map((b)=>b.currency)).toEqual(["JPY","USD"]);
  });
  it("treats Stripe paid as unverified bank receipt and checks payout balance", () => {
    const {local,provider}=fixture();provider.payouts=[{id:"po_1",amount:3820,currency:"JPY",status:"paid",arrivalAt:"2026-09-18",balanceId:"txn_payout"}];
    provider.balances.push({id:"txn_payout",currency:"JPY",amount:-3820,fee:0,net:-3820,status:"available",type:"payout"});
    expect(reconcileFinance(local,provider).payouts[0].bankReceipt).toBe("UNVERIFIED");
    provider.payouts[0].status="failed";provider.payouts[0].amount=999;
    expect(codes(reconcileFinance(local,provider))).toEqual(expect.arrayContaining(["PAYOUT_NOT_PAID","PAYOUT_AMOUNT_MISMATCH"]));
    provider.payouts[0].balanceId=null;expect(codes(reconcileFinance(local,provider))).toContain("PAYOUT_BALANCE_UNVERIFIED");
  });
  it("rejects sum overflow instead of producing approximate money", () => {
    const {local,provider}=fixture();local.payments.push({...local.payments[0],externalId:"pi_2",captured:Number.MAX_SAFE_INTEGER});
    expect(()=>reconcileFinance(local,provider)).toThrow("safe integer");
  });
});
