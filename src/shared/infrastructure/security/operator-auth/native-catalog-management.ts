import { CatalogManagementError } from "@/modules/catalog/public";
import { PostgresCatalogManager, catalogSaveSchema } from "@/modules/catalog/infrastructure/postgres-catalog-manager";
import { PostgresStockManager, stockChangeSchema } from "@/modules/inventory/infrastructure/postgres-stock-manager";
import { withCatalogManager } from "./native-catalog-transaction";
import { getCatalogManagerDatabaseClient } from "../../database/database-connections";
import { GoogleFulfillmentOperatorIdentity } from "./google-operator-identity";
import { getOperatorAuth } from "./operator-auth";

async function context(origin?: string | null) {
  const auth = getOperatorAuth();
  if (!auth || (origin !== undefined && origin !== auth.config.origin)) throw new CatalogManagementError("DENIED");
  // Reuse the verified Google subject binding; fulfillment/Shopify grants confer no catalog authority.
  const actor = await new GoogleFulfillmentOperatorIdentity(() => auth.auth.auth(), auth.config.bindings).current();
  if (!actor) throw new CatalogManagementError("DENIED");
  return { actor, sql: getCatalogManagerDatabaseClient() };
}
export async function readManagedCatalog(after?: string) {
  const { actor, sql } = await context();
  return withCatalogManager(sql, actor, async (tx) => {
    const page = await new PostgresCatalogManager(tx).list(after);
    const stock = await new PostgresStockManager(tx).read(page.products.map((p) => p.id));
    return { ...page, stock };
  });
}
export async function changeManagedCatalog(form: FormData, origin: string | null) {
  const { actor, sql } = await context(origin);
  const entries = [...form.entries()].filter(([key]) => !key.startsWith("$ACTION_"));
  if (entries.some(([, v]) => typeof v !== "string") || new Set(entries.map(([key]) => key)).size !== entries.length) throw new CatalogManagementError("INVALID");
  const values = Object.fromEntries(entries);
  const operation = values.operation;
  delete values.operation;
  const integer = (v: FormDataEntryValue | undefined) => typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : NaN;
  if (operation === "stock") {
    const parsed = stockChangeSchema.safeParse({ ...values, expectedVersion: integer(values.expectedVersion), delta: integer(values.delta) });
    if (!parsed.success) throw new CatalogManagementError("INVALID");
    return withCatalogManager(sql, actor, (tx) => new PostgresStockManager(tx).change(parsed.data, actor.operatorId));
  }
  if (operation !== "catalog" || !["true", "false"].includes(String(values.available))) throw new CatalogManagementError("INVALID");
  const lines = (v: FormDataEntryValue | undefined) => typeof v === "string" ? v.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  const parsed = catalogSaveSchema.safeParse({ ...values, expectedVersion: integer(values.expectedVersion), price: integer(values.price),
    shippingAmount: values.shippingAmount === undefined || values.shippingAmount === "" ? null : integer(values.shippingAmount),
    available: values.available === "true", occasions: lines(values.occasions), flowers: lines(values.flowers) });
  if (!parsed.success) throw new CatalogManagementError("INVALID");
  return withCatalogManager(sql, actor, (tx) => new PostgresCatalogManager(tx).save(parsed.data, actor));
}
