import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PermissionRevocationError } from "@/modules/fulfillment/public";
import { preparePermissionManagement } from "@/shared/infrastructure/security/operator-auth/operator-permissions";
import { operatorPermissionsContent as copy } from "@/shared/infrastructure/content/operator-permissions-content";
import { OperatorPermissions } from "@/ui/operator-permissions";
import { revokePermission } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.title, robots: { index: false, follow: false } };
export default async function PermissionManagement({ searchParams }: { searchParams: Promise<{ shop?: string | string[]; cursor?: string | string[] }> }) {
  const parameters = await searchParams;
  const input = z.object({ shop: z.string().optional(), cursor: z.string().optional() }).strict().safeParse(parameters);
  const state = input.success ? await load(input.data) : { page: null, error: copy.invalid };
  return <section className="section-shell content-page permission-management-page">
    <header className="content-header"><p className="eyebrow">BLOOMBOX OPERATIONS</p><h1>{copy.title}</h1><p>{copy.lead}</p></header>
    <form method="get" action="/operations/permissions" className="fulfillment-inbox-search">
      <div className="form-field"><label htmlFor="permission-shop">{copy.shopLabel}</label>
        <input id="permission-shop" name="shop" required defaultValue={state.page?.shop ?? ""} aria-describedby="permission-shop-hint"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <p className="form-hint" id="permission-shop-hint">{copy.shopHint}</p></div>
      <button className="primary-button" type="submit">{copy.search}</button>
    </form>
    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state.page ? <OperatorPermissions page={state.page} action={revokePermission} /> : null}
    <Link className="text-link" href="/operations">{copy.login}</Link>
  </section>;
}
async function load(input: { shop?: string; cursor?: string }) {
  try { return { page: await preparePermissionManagement(input), error: null }; }
  catch (error) {
    if (error instanceof PermissionRevocationError) {
      if (error.code === "NOT_AUTHORIZED") notFound();
      if (error.code === "INVALID_REQUEST") return { page: null, error: copy.invalid };
    }
    console.error("operator_permissions_unavailable");
    return { page: null, error: copy.unavailable };
  }
}
