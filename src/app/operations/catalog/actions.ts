"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { CatalogManagementError, type CatalogManagementState } from "@/modules/catalog/public";
import { StockManagementError } from "@/modules/inventory/public";
import { changeManagedCatalog } from "@/shared/infrastructure/security/operator-auth/native-catalog-management";
export async function saveCatalogManagement(_previous: CatalogManagementState, form: FormData): Promise<CatalogManagementState> {
  try { await changeManagedCatalog(form, (await headers()).get("origin")); }
  catch (error) {
    if (error instanceof CatalogManagementError || error instanceof StockManagementError) {
      if (error.code === "UNAVAILABLE") console.error("native_catalog_management_unavailable");
      return {status:error.code};
    }
    console.error("native_catalog_management_unavailable");
    return {status:"UNAVAILABLE"};
  }
  try { revalidatePath("/operations/catalog"); revalidatePath("/products"); revalidatePath("/", "layout"); }
  catch { console.error("native_catalog_refresh_unavailable"); }
  return {status:"SAVED"};
}
