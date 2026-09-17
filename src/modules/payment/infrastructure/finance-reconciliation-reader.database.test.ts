import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readLocalFinance } from "./finance-reconciliation-reader";
const url=process.env.TEST_DATABASE_URL;
if(url && (!["127.0.0.1","localhost"].includes(new URL(url).hostname)||!new URL(url).pathname.includes("test"))) throw new Error("Isolated test database required");
(url?describe:describe.skip)("finance read-only database report",()=>{
  const sql=postgres(url??"postgres://invalid/test",{ssl:false,max:1});
  const role=`finance_test_${randomUUID().replaceAll("-","")}`;
  const reader=postgres(url??"postgres://invalid/test",{ssl:false,max:1,connection:{options:`-c role=${role}`}});
  const order=randomUUID(),payment=randomUUID(),capture=randomUUID(),refund=randomUUID();
  beforeAll(async()=>{
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node",["scripts/migrate-database.mjs"],{env:{...process.env,DATABASE_URL:url,DATABASE_SSL_MODE:"disable"},stdio:"pipe"});
    await sql.unsafe(`CREATE ROLE ${role} NOLOGIN`);
    await sql.unsafe(`GRANT USAGE ON SCHEMA bloombox TO ${role}`);
    await sql.unsafe(`GRANT SELECT ON bloombox.payments, bloombox.refunds, bloombox.disputes, bloombox.financial_transactions, bloombox.ledger_entries TO ${role}`);
    await sql`INSERT INTO bloombox.orders(id,display_id,status,commerce_provider,external_order_id,currency,subtotal_minor,tax_minor,shipping_minor,discount_minor,total_minor,created_at,updated_at)
      VALUES(${order},${order},'CONFIRMED','STRIPE',${order},'JPY',4000,0,1000,0,5000,now(),now())`;
    await sql`INSERT INTO bloombox.payments(id,order_id,commerce_provider,external_payment_id,status,amount_requested_minor,amount_authorized_minor,amount_captured_minor,amount_refunded_minor,currency,created_at,updated_at)
      VALUES(${payment},${order},'STRIPE','pi_finance','PARTIALLY_REFUNDED',5000,5000,5000,1000,'JPY',now(),now())`;
    await sql`INSERT INTO bloombox.refunds(id,payment_id,commerce_provider,external_refund_id,status,amount_minor,currency,reason_code,created_at,updated_at)
      VALUES(${randomUUID()},${payment},'STRIPE','re_finance','SUCCEEDED',1000,'JPY','requested_by_customer',now(),now())`;
    await sql`INSERT INTO bloombox.disputes(id,payment_id,commerce_provider,external_dispute_id,status,amount_minor,currency,created_at,updated_at)
      VALUES(${randomUUID()},${payment},'STRIPE','dp_finance','NEEDS_RESPONSE',5000,'JPY',now(),now())`;
    for(const [id,type,amount] of [[capture,"CAPTURE",5000],[refund,"REFUND",-1000]] as const){
      await sql.begin(async(tx)=>{
        await tx`INSERT INTO bloombox.financial_transactions(id,order_id,payment_id,transaction_type,currency,external_reference,occurred_at)
          VALUES(${id},${order},${payment},${type},'JPY',${id},now())`;
        await tx`INSERT INTO bloombox.ledger_entries(id,financial_transaction_id,account_code,signed_amount_minor,currency)
          VALUES(${randomUUID()},${id},'STRIPE_CLEARING',${amount},'JPY'),(${randomUUID()},${id},'ORDER_REVENUE',${-amount},'JPY')`;
      });
    }
  });
  afterAll(async()=>{await reader.end();await sql.unsafe(`DROP OWNED BY ${role}`);await sql.unsafe(`DROP ROLE ${role}`);await sql.end();});
  it("reads exact capture/refund amounts without multiplying entries and requires only financial SELECT grants",async()=>{
    const snapshot=await readLocalFinance(reader);
    expect(snapshot.payments).toEqual([{id:payment,externalId:"pi_finance",currency:"JPY",captured:5000,refunded:1000,ledgerCaptured:5000,ledgerRefunded:1000,ledgerImbalanced:false}]);
    expect(snapshot.refunds[0]).toMatchObject({id:"re_finance",amount:1000,status:"SUCCEEDED"});
    expect(snapshot.disputes[0]).toMatchObject({id:"dp_finance",status:"NEEDS_RESPONSE"});
    await expect(reader`UPDATE bloombox.payments SET amount_refunded_minor=0`).rejects.toMatchObject({code:"42501"});
    await expect(reader`SELECT * FROM bloombox.customer_contacts`).rejects.toMatchObject({code:"42501"});
    expect(await readLocalFinance(reader)).toEqual(snapshot);
  });
  it("reports Stripe clearing entries that have no matching payment",async()=>{
    const orphan=randomUUID();
    await sql.begin(async(tx)=>{
      await tx`INSERT INTO bloombox.financial_transactions(id,transaction_type,currency,occurred_at) VALUES(${orphan},'CAPTURE','JPY',now())`;
      await tx`INSERT INTO bloombox.ledger_entries(id,financial_transaction_id,account_code,signed_amount_minor,currency)
        VALUES(${randomUUID()},${orphan},'STRIPE_CLEARING',500,'JPY'),(${randomUUID()},${orphan},'ORDER_REVENUE',-500,'JPY')`;
    });
    expect((await readLocalFinance(reader)).orphanLedgerIds).toEqual([orphan]);
  });
  it("surfaces a balanced but incorrect refund ledger for reconciliation",async()=>{
    await sql.begin(async(tx)=>{
      await tx`UPDATE bloombox.ledger_entries SET signed_amount_minor=CASE WHEN account_code='STRIPE_CLEARING' THEN -900 ELSE 900 END WHERE financial_transaction_id=${refund}`;
    });
    expect((await readLocalFinance(reader)).payments[0].ledgerRefunded).toBe(900);
  });
});
