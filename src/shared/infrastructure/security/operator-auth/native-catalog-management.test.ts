import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { changeManagedCatalog, readManagedCatalog } from "./native-catalog-management";
const mocks=vi.hoisted(()=>({auth:vi.fn(),database:vi.fn(),transaction:vi.fn(),save:vi.fn(),change:vi.fn()}));
vi.mock("./operator-auth",()=>({getOperatorAuth:mocks.auth}));
vi.mock("../../database/database-connections",()=>({getCatalogManagerDatabaseClient:mocks.database}));
vi.mock("./native-catalog-transaction",()=>({withCatalogManager:mocks.transaction}));
vi.mock("@/modules/catalog/infrastructure/postgres-catalog-manager",async(original)=>({...await original<typeof import("@/modules/catalog/infrastructure/postgres-catalog-manager")>(),
  PostgresCatalogManager:class {save=mocks.save;}}));
vi.mock("@/modules/inventory/infrastructure/postgres-stock-manager",async(original)=>({...await original<typeof import("@/modules/inventory/infrastructure/postgres-stock-manager")>(),
  PostgresStockManager:class {change=mocks.change;}}));
const operatorId=randomUUID();const origin="https://operators.example";
function service(){return {config:{origin,bindings:[{subject:"google-subject",operatorId}]},auth:{auth:async()=>({user:{id:"google-subject"},expires:new Date(Date.now()+60000).toISOString()})}};}
function stock(){const f=new FormData();Object.entries({operation:"stock",productId:randomUUID(),expectedVersion:"0",requestId:randomUUID(),delta:"2",reason:"RECEIVED"}).forEach(([k,v])=>f.set(k,v));return f;}
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockReturnValue(service());mocks.transaction.mockImplementation(async(_sql,_actor,work)=>work({}));});
describe("native management trust boundary",()=>{
  it.each([null,"https://evil.example"])("rejects origin %s before opening a database",async(o)=>{
    await expect(changeManagedCatalog(stock(),o)).rejects.toMatchObject({code:"DENIED"});expect(mocks.database).not.toHaveBeenCalled();
  });
  it("rejects disabled login and unbound/customer sessions before reads or writes",async()=>{
    mocks.auth.mockReturnValue(null);await expect(readManagedCatalog()).rejects.toMatchObject({code:"DENIED"});
    const s=service();s.config.bindings=[];mocks.auth.mockReturnValue(s);await expect(changeManagedCatalog(stock(),origin)).rejects.toMatchObject({code:"DENIED"});
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("uses the verified subject binding and preserves the request id for exact retry",async()=>{
    const f=stock();await changeManagedCatalog(f,origin);await changeManagedCatalog(f,origin);
    expect(mocks.transaction.mock.calls[0][1]).toMatchObject({operatorId});
    expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({delta:2,requestId:f.get("requestId")}),operatorId);
  });
  it.each(["duplicate","actor","fraction","blank","file","extra"])("rejects %s input without a write",async(kind)=>{
    const f=stock();if(kind==="duplicate")f.append("delta","3");if(kind==="actor")f.set("operatorId",operatorId);
    if(kind==="fraction")f.set("delta","1.5");if(kind==="blank")f.set("delta","");if(kind==="file")f.set("reason",new Blob(["RECEIVED"]));if(kind==="extra")f.set("authorized","true");
    await expect(changeManagedCatalog(f,origin)).rejects.toMatchObject({code:"INVALID"});expect(mocks.change).not.toHaveBeenCalled();
  });
});
