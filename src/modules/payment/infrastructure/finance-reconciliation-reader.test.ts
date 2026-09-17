import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { z } from "zod";
import { readFinancePages, readProviderFinance } from "./finance-reconciliation-reader";
import { STRIPE_API_VERSION } from "@/shared/infrastructure/config/stripe-config";
const empty = () => Promise.resolve(new Response(JSON.stringify({data:[],has_more:false}),{status:200}));
function client(fetcher: typeof fetch) {
  return new Stripe("rk_test_synthetic",{maxNetworkRetries:0,httpClient:Stripe.createFetchHttpClient(fetcher)});
}
describe("finance Stripe reader",()=>{
  it("paginates without dropping records and rejects duplicates/stuck cursors",async()=>{
    const page=vi.fn().mockResolvedValueOnce({data:[{id:"a"}],has_more:true}).mockResolvedValueOnce({data:[{id:"b"}],has_more:false});
    expect(await readFinancePages(page,z.object({id:z.string()}))).toEqual([{id:"a"},{id:"b"}]);
    expect(page.mock.calls[1][0]).toEqual({limit:100,starting_after:"a"});
    await expect(readFinancePages(async()=>({data:[],has_more:true}),z.object({id:z.string()}))).rejects.toThrow("advance");
    await expect(readFinancePages(async()=>({data:[{id:"same"}],has_more:true}),z.object({id:z.string()}))).rejects.toThrow("duplicate");
  });
  it("fails on a complete-history limit instead of returning a partial report",async()=>{
    let page=0;await expect(readFinancePages(async()=>({data:Array.from({length:100},(_,i)=>({id:`page${page}-${i}`})),has_more:++page>0}),z.object({id:z.string()}))).rejects.toThrow("limit");
  });
  it("uses GET only, validates account and drops unrelated personal data",async()=>{
    const methods:string[]=[];
    const stripe=client(async(input,init)=>{
      methods.push(init?.method??"GET");expect(new Headers(init?.headers).get("stripe-version")).toBe(STRIPE_API_VERSION);const url=String(input);
      if(url.endsWith("/account")) return new Response(JSON.stringify({id:"acct_sample"}));
      if(url.includes("/charges")) return new Response(JSON.stringify({data:[{id:"ch_1",payment_intent:"pi_1",currency:"jpy",amount_captured:5000,paid:true,livemode:false,balance_transaction:null,billing_details:{email:"private@example.test"}}],has_more:false}));
      return empty();
    });
    const result=await readProviderFinance(stripe,"test","acct_sample",STRIPE_API_VERSION);expect(methods.every((m)=>m==="GET")).toBe(true);
    expect(result.charges[0]).toMatchObject({currency:"JPY",captured:5000});expect(JSON.stringify(result)).not.toContain("private");
    await expect(readProviderFinance(stripe,"test","acct_other",STRIPE_API_VERSION)).rejects.toThrow("account mismatch");
  });
  it("rejects wrong mode and API failures without producing a snapshot",async()=>{
    const stripe=client(async(input)=>String(input).endsWith("/account")?new Response(JSON.stringify({id:"acct_sample"})):new Response(JSON.stringify({data:[{id:"ch_1",payment_intent:"pi_1",currency:"jpy",amount_captured:1,paid:true,livemode:true,balance_transaction:null}],has_more:false})));
    await expect(readProviderFinance(stripe,"test","acct_sample",STRIPE_API_VERSION)).rejects.toThrow();
    await expect(readProviderFinance(client(async()=>new Response("failure",{status:500})),"test","acct_sample",STRIPE_API_VERSION)).rejects.toThrow();
  });
});
