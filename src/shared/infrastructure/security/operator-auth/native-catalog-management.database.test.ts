import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PostgresCatalogManager } from "@/modules/catalog/infrastructure/postgres-catalog-manager";
import { PostgresStockManager } from "@/modules/inventory/infrastructure/postgres-stock-manager";
import { PostgresInventoryReservations } from "@/modules/inventory/infrastructure/postgres-inventory-reservations";
import { PostgresProductRepository } from "@/modules/catalog/infrastructure/postgres-product-repository";
import { PostgresStockAvailabilityReader } from "@/modules/inventory/infrastructure/postgres-stock-availability-reader";
import { PostgresPurchaseIntentRepository } from "@/modules/checkout/infrastructure/postgres-purchase-intent-repository";
import { CreatePurchaseIntent } from "@/modules/checkout/application/create-purchase-intent";
import { AesGcmDataProtector } from "../aes-gcm-data-protector";
import type { CatalogSave, ManagementActor } from "@/modules/catalog/public";
import type { StockChange } from "@/modules/inventory/public";
import { withCatalogManager } from "./native-catalog-transaction";
const url=process.env.TEST_DATABASE_URL;
if (url && (!["127.0.0.1","localhost"].includes(new URL(url).hostname) || !new URL(url).pathname.includes("test"))) throw new Error("Isolated test database required");
(url ? describe : describe.skip)("native catalog management", () => {
  const owner=postgres(url ?? "postgres://invalid/test",{ssl:false,max:8});
  const manager=postgres(url ?? "postgres://invalid/test",{ssl:false,max:8,connection:{options:"-c role=bloombox_catalog_manager"}});
  const actor:ManagementActor={operatorId:randomUUID(),expiresAt:new Date(Date.now()+3600000)};
  beforeAll(async()=>{
    await owner.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for(let i=0;i<2;i++) execFileSync("node",["scripts/migrate-database.mjs"],{env:{...process.env,DATABASE_URL:url,DATABASE_SSL_MODE:"disable"},stdio:"pipe"});
    await owner.unsafe((await readFile("database/roles.sql","utf8")).replace(/^\\set ON_ERROR_STOP on$/m,""));
    await owner`INSERT INTO bloombox.native_catalog_operators (operator_id,enabled,valid_until) VALUES (${actor.operatorId},true,clock_timestamp()+interval '1 hour')`;
  });
  afterAll(async()=>{await manager.end();await owner.end();});
  const save=(p:CatalogSave,a=actor)=>withCatalogManager(manager,a,(tx)=>new PostgresCatalogManager(tx).save(p,a));
  const change=(p:StockChange,a=actor)=>withCatalogManager(manager,a,(tx)=>new PostgresStockManager(tx).change(p,a.operatorId));
  function draft():CatalogSave {const id=randomUUID(); return {id,requestId:randomUUID(),expectedVersion:0,slug:"test-"+id,status:"DRAFT",available:false,
    name:"試験商品",subtitle:"紹介",description:"試験の説明",price:4000,shippingAmount:1000,imageUrl:"https://images.unsplash.com/test-only",imageAlt:"試験",palette:"白",occasions:["試験"],flowers:["花"],grower:"試験生産者"};}
  async function product(){const p=draft();await save(p);return p;}
  const adjustment=(id:string,delta=10,version=0):StockChange=>({productId:id,delta,expectedVersion:version,requestId:randomUUID(),reason:"RECEIVED"});
  async function balance(id:string){const [r]=await owner`SELECT on_hand,reserved,version::text AS version FROM bloombox.inventory_stock WHERE product_id=${id}`;return r;}
  it("audits shipping edits with scoped credentials, preserves zero versus missing and rejects unsafe amounts", async () => {
    const p = { ...draft(), shippingAmount: null };
    await save(p);
    for (const [index, shippingAmount] of [1000, 0].entries()) {
      const update = { ...p, requestId: randomUUID(), expectedVersion: index + 1, shippingAmount };
      await save(update); await save(update);
      await expect(save({ ...update, shippingAmount: shippingAmount + 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    }
    const changes = await owner`SELECT command, before_snapshot FROM bloombox.catalog_changes WHERE product_id = ${p.id} ORDER BY version`;
    expect(changes.map((r) => r.command.shippingAmount)).toEqual([null, 1000, 0]);
    expect(changes[2].before_snapshot.shipping_minor).toBe(1000);
    const page = await withCatalogManager(manager, actor, (tx) => new PostgresCatalogManager(tx).list());
    expect(page.products.find((product) => product.id === p.id)?.shippingAmount).toBe(0);
    for (const shippingAmount of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
      await expect(save({ ...p, requestId: randomUUID(), expectedVersion: 3, shippingAmount })).rejects.toMatchObject({ code: "INVALID" });
    }
  });
  it("creates a draft once under concurrent retries, rejects changed payload and stale edits, and retains before/after history",async()=>{
    const p=draft();await Promise.all([save(p),save(p),save(p)]);
    await expect(save({...p,name:"改変"})).rejects.toMatchObject({code:"CONFLICT"});
    const update={...p,requestId:randomUUID(),expectedVersion:1,name:"更新",status:"PUBLISHED" as const,available:true};
    await save(update);await save(update);
    await expect(save({...update,requestId:randomUUID(),price:5000})).rejects.toMatchObject({code:"CONFLICT"});
    const rows=await owner`SELECT before_snapshot,command FROM bloombox.catalog_changes WHERE product_id=${p.id} ORDER BY version`;
    expect(rows).toHaveLength(2);expect(rows[1].before_snapshot.name).toBe(p.name);expect(rows[1].command.name).toBe("更新");
    await expect(save({...draft(),status:"PUBLISHED",available:true})).rejects.toMatchObject({code:"INVALID"});
  });
  it("requires native authority, current session and grant; revocation also blocks previously successful retries",async()=>{
    const p=await product();
    await expect(save(draft(),{...actor,operatorId:randomUUID()})).rejects.toMatchObject({code:"DENIED"});
    await expect(save(draft(),{...actor,expiresAt:new Date(0)})).rejects.toMatchObject({code:"DENIED"});
    await owner`UPDATE bloombox.native_catalog_operators SET enabled=false WHERE operator_id=${actor.operatorId}`;
    try {await expect(save(p)).rejects.toMatchObject({code:"DENIED"});await expect(withCatalogManager(manager,actor,(tx)=>new PostgresCatalogManager(tx).list())).rejects.toMatchObject({code:"DENIED"});}
    finally {await owner`UPDATE bloombox.native_catalog_operators SET enabled=true WHERE operator_id=${actor.operatorId}`;}
  });
  it("rechecks session expiry after work and rolls back state and history",async()=>{
    const p=draft();const expiresAt=new Date(Date.now()+300);
    await expect(withCatalogManager(manager,{...actor,expiresAt},async(tx)=>{await new PostgresCatalogManager(tx).save(p,actor);await tx`SELECT pg_sleep(0.4)`;})).rejects.toMatchObject({code:"DENIED"});
    expect(await owner`SELECT id FROM bloombox.catalog_products WHERE id=${p.id}`).toHaveLength(0);
    expect(await owner`SELECT request_id FROM bloombox.catalog_changes WHERE request_id=${p.requestId}`).toHaveLength(0);
  });
  it("serializes concurrent replenishment and rejects same-key payload changes and stale versions",async()=>{
    const p=await product(),c=adjustment(p.id);await Promise.all([change(c),change(c),change(c)]);
    expect(await balance(p.id)).toMatchObject({on_hand:10,reserved:0,version:"1"});
    await expect(change({...c,delta:20})).rejects.toMatchObject({code:"CONFLICT"});
    const results=await Promise.allSettled([change(adjustment(p.id,5,1)),change(adjustment(p.id,7,1))]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(await owner`SELECT request_id FROM bloombox.inventory_adjustments WHERE product_id=${p.id}`).toHaveLength(2);
    const v=Number((await balance(p.id)).version);
    await expect(change({...adjustment(p.id,-1,v),reason:"RECEIVED"})).rejects.toMatchObject({code:"INVALID"});
    await expect(change(adjustment(p.id,1000000,v))).rejects.toMatchObject({code:"INVALID"});
  });
  it("preserves real reservations and serializes a correction racing a purchase",async()=>{
    const p=await product();await save({...p,expectedVersion:1,requestId:randomUUID(),status:"PUBLISHED",available:true});await change(adjustment(p.id,2));
    const protector=new AesGcmDataProtector({activeKeyId:"test",keys:new Map([["test",Buffer.alloc(32,9)]])});
    const repo=new PostgresPurchaseIntentRepository(owner,protector,undefined,(tx)=>new PostgresInventoryReservations(tx));
    const create=new CreatePurchaseIntent(new PostgresProductRepository(owner,new PostgresStockAvailabilityReader(owner)),repo,()=>new Date("2026-09-13T00:00:00Z"));
    const purchase=()=>create.execute({requestId:randomUUID(),productId:`native_${p.id}`,quantity:1,recipientName:"試験",deliveryDate:"2026-09-20",giftMessage:"試験"});
    await purchase();
    await expect(change({...adjustment(p.id,-2,2),reason:"CORRECTION"})).rejects.toMatchObject({code:"INVALID"});
    const results=await Promise.allSettled([purchase(),change({...adjustment(p.id,-1,2),reason:"CORRECTION"})]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const b=await balance(p.id);expect(b.on_hand).toBe(b.reserved);expect(b.reserved).toBeGreaterThanOrEqual(1);
  });
  it.each(["catalog_changes","inventory_adjustments"] as const)("rolls back when %s history cannot be written and permits exact retry",async(table)=>{
    const p=table==="catalog_changes"?draft():await product();const c=adjustment(p.id);
    await owner.unsafe(`REVOKE INSERT ON bloombox.${table} FROM bloombox_catalog_manager`);
    try {
      await expect(table==="catalog_changes"?save(p):change(c)).rejects.toMatchObject({code:"UNAVAILABLE"});
      expect(await owner.unsafe(`SELECT * FROM bloombox.${table} WHERE product_id=$1`,[p.id])).toHaveLength(0);
      if(table==="catalog_changes")expect(await owner`SELECT id FROM bloombox.catalog_products WHERE id=${p.id}`).toHaveLength(0);
      else expect(await balance(p.id)).toBeUndefined();
    } finally {await owner.unsafe(`GRANT INSERT ON bloombox.${table} TO bloombox_catalog_manager`);}
    await(table==="catalog_changes"?save(p):change(c));
  });
  it("does not permit grant mutation, reserved quantity mutation, history tampering, or order access through management credentials",async()=>{
    for(const statement of ["UPDATE bloombox.native_catalog_operators SET enabled=true","UPDATE bloombox.inventory_stock SET reserved=0",
      "INSERT INTO bloombox.inventory_stock (product_id, on_hand, reserved) VALUES ('00000000-0000-4000-8000-000000000001', 2, 1)",
      "DELETE FROM bloombox.catalog_changes","UPDATE bloombox.inventory_adjustments SET delta=1","SELECT * FROM bloombox.orders","DELETE FROM bloombox.catalog_products"])
      await expect(manager.unsafe(statement)).rejects.toMatchObject({code:"42501"});
    await expect(owner.begin(async(tx)=>{await tx`SET LOCAL ROLE bloombox_application`;
      await tx`SELECT * FROM bloombox.lock_native_catalog_operator(${actor.operatorId}::uuid)`;
    })).rejects.toMatchObject({code:"42501"});
  });
  it("lists native products only to authorized operators with bounded pagination",async()=>{
    await Promise.all(Array.from({length:31},()=>save(draft())));
    const page=await withCatalogManager(manager,actor,(tx)=>new PostgresCatalogManager(tx).list());
    expect(page.products).toHaveLength(30);expect(page.next).toBe(page.products[29].id);
    const after=page.products[0].id;
    const next=await withCatalogManager(manager,actor,(tx)=>new PostgresCatalogManager(tx).list(after));
    expect(next.products.every(p=>p.id>after)).toBe(true);
  });
});
