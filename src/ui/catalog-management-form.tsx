"use client";
import { useActionState, useId } from "react";
import type { ManagedProduct, CatalogManagementState } from "@/modules/catalog/public";
import { MAX_STOCK_QUANTITY, type StockSnapshot } from "@/modules/inventory/public";
import { catalogManagementContent as copy } from "@/shared/infrastructure/content/catalog-management-content";
export type CatalogAction = (previous: CatalogManagementState, form: FormData) => Promise<CatalogManagementState>;
const fields = ["slug", "name", "subtitle", "description", "price", "imageUrl", "imageAlt", "palette", "occasions", "flowers", "grower"] as const;
const limits = {slug:120, name:80, subtitle:120, description:2000, price:16, imageUrl:2048, imageAlt:200, palette:100, occasions:2419, flowers:2419, grower:120};
export function CatalogManagementForm({ product, id, requestId, action }: {product?: ManagedProduct; id: string; requestId: string; action: CatalogAction}) {
  const [state, submit, pending] = useActionState<CatalogManagementState, FormData>(action, {status:"IDLE"});
  const prefix = useId();
  return <div><form action={submit} onReset={(e) => e.preventDefault()} className="catalog-management-form">
    <input type="hidden" name="operation" value="catalog"/><input type="hidden" name="id" value={id}/>
    <input type="hidden" name="requestId" value={requestId}/><input type="hidden" name="expectedVersion" value={product?.version ?? 0}/>
    <fieldset disabled={pending || state.status === "SAVED"}>
      <legend>{product ? copy.edit : copy.newProduct}</legend>
      {fields.map((field) => { const raw = product?.[field]; const value = Array.isArray(raw) ? raw.join("\n") : raw ?? "";
        const multiline = ["description", "occasions", "flowers"].includes(field);
        return <div className="form-field" key={field}><label htmlFor={`${prefix}-${field}`}>{copy.labels[field]}</label>
          {multiline ? <textarea id={`${prefix}-${field}`} name={field} required rows={3} maxLength={limits[field]} defaultValue={value}/>
            : <input id={`${prefix}-${field}`} name={field} required type={field === "price" ? "number" : "text"} min={field === "price" ? 0 : undefined}
              step={field === "price" ? 1 : undefined} maxLength={limits[field]} defaultValue={value}/>}
        </div>; })}
      <p className="form-hint">{copy.imageHint} {copy.listHint}</p>
      {product ? <><div className="form-field"><label htmlFor={`${prefix}-status`}>{copy.labels.status}</label><select id={`${prefix}-status`} name="status" defaultValue={product.status}>
        {(["DRAFT", "PUBLISHED", "ARCHIVED"] as const).map((s) => <option key={s} value={s}>{copy.statuses[s]}</option>)}</select></div>
        <div className="form-field"><label htmlFor={`${prefix}-available`}>{copy.labels.available}</label><select id={`${prefix}-available`} name="available" defaultValue={String(product.available)}>
          <option value="false">{copy.no}</option><option value="true">{copy.yes}</option></select></div></>
        : <><input type="hidden" name="status" value="DRAFT"/><input type="hidden" name="available" value="false"/><p>{copy.draftHint}</p></>}
      <button className="primary-button" type="submit">{pending ? copy.saving : copy.save}</button>
    </fieldset>
  </form><FormResult state={state}/></div>;
}
export function StockManagementForm({ productId, stock, requestId, action }: { productId: string; stock?: StockSnapshot; requestId: string; action: CatalogAction }) {
  const [state, submit, pending] = useActionState<CatalogManagementState, FormData>(action, {status:"IDLE"}); const id=useId();
  return <div><form action={submit} onReset={(e) => e.preventDefault()} className="catalog-management-form">
    <input type="hidden" name="operation" value="stock"/><input type="hidden" name="productId" value={productId}/>
    <input type="hidden" name="requestId" value={requestId}/><input type="hidden" name="expectedVersion" value={stock?.version ?? 0}/>
    <fieldset disabled={pending || state.status === "SAVED"}><legend>{copy.stockTitle}</legend>
      <p id={`${id}-hint`}>{copy.stockHint}</p><div className="form-field"><label htmlFor={`${id}-delta`}>{copy.delta}</label>
        <input id={`${id}-delta`} name="delta" type="number" step={1} min={-MAX_STOCK_QUANTITY} max={MAX_STOCK_QUANTITY} required aria-describedby={`${id}-hint`}/></div>
      <div className="form-field"><label htmlFor={`${id}-reason`}>{copy.reason}</label><select id={`${id}-reason`} name="reason" defaultValue="RECEIVED">
        <option value="RECEIVED">{copy.received}</option><option value="CORRECTION">{copy.correction}</option></select></div>
      <button className="secondary-button" type="submit">{pending ? copy.saving : copy.stockSave}</button>
    </fieldset></form><FormResult state={state}/></div>;
}
function FormResult({state}:{state: CatalogManagementState}) {
  return <><p role={["IDLE","SAVED"].includes(state.status) ? "status" : "alert"} aria-live="polite">{copy.messages[state.status]}</p>
    {state.status !== "IDLE" ? <button className="text-link" type="button" onClick={() => window.location.reload()}>{copy.refresh}</button> : null}</>;
}
