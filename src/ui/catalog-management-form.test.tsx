import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogManagementForm, StockManagementForm, type CatalogAction } from "./catalog-management-form";
import type { CatalogManagementState } from "@/modules/catalog/public";
import { catalogManagementContent as copy } from "@/shared/infrastructure/content/catalog-management-content";
const hook=vi.hoisted(()=>({status:"IDLE" as CatalogManagementState["status"],pending:false}));
vi.mock("react",async(original)=>({...await original<typeof import("react")>(),useActionState:()=>[{status:hook.status},"/synthetic-action",hook.pending]}));
const action:CatalogAction=async()=>({status:"SAVED"});
beforeEach(()=>{hook.status="IDLE";hook.pending=false;});
describe("native management forms",()=>{
  it("creates only drafts, labels fields and sends no operator authority",()=>{const html=renderToStaticMarkup(<CatalogManagementForm id="product" requestId="request" action={action}/>);
    expect(html).toContain('name="status" value="DRAFT"');expect(html).toContain('name="available" value="false"');expect(html).toContain(copy.draftHint);
    expect(html).toContain('name="expectedVersion" value="0"');expect(html).not.toContain('name="operatorId"');expect(html).toContain('name="shippingAmount"');expect(html).toContain(copy.shippingHint);expect(html.match(/<label /g)?.length).toBe(12);});
  it("keeps request context visible for uncertain results and disables completed or pending actions",()=>{
    hook.status="UNAVAILABLE";let html=renderToStaticMarkup(<StockManagementForm productId="product" requestId="same-request" action={action}/>);
    expect(html).toContain('value="same-request"');expect(html).toContain('role="alert"');expect(html).toContain(copy.messages.UNAVAILABLE);
    hook.pending=true;html=renderToStaticMarkup(<StockManagementForm productId="product" requestId="same-request" action={action}/>);expect(html).toContain('disabled=""');
    hook.pending=false;hook.status="SAVED";html=renderToStaticMarkup(<StockManagementForm productId="product" requestId="same-request" action={action}/>);expect(html).toContain('disabled=""');expect(html).toContain(copy.messages.SAVED);
  });
});
