"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { NativeFulfillmentError, type NativeFulfillmentFormState } from "@/modules/fulfillment/public";
import { changeNativeFulfillment } from "@/shared/infrastructure/security/operator-auth/native-fulfillment-management";
export async function saveNativeFulfillment(_previous: NativeFulfillmentFormState, form: FormData): Promise<NativeFulfillmentFormState> {
  try {
    if (form.getAll("confirmed").length !== 1 || form.get("confirmed") !== "yes") return { status: "INVALID" };
    form.delete("confirmed");
    await changeNativeFulfillment(form, (await headers()).get("origin"));
  } catch (error) {
    if (error instanceof NativeFulfillmentError) {
      if (error.code === "UNAVAILABLE") console.error("native_fulfillment_change_unavailable");
      return { status: error.code };
    }
    console.error("native_fulfillment_change_unavailable");
    return { status: "UNAVAILABLE" };
  }
  try { revalidatePath("/operations/native-fulfillments", "page"); revalidatePath("/operations/native-fulfillments/[fulfillmentId]", "page"); revalidatePath("/account/orders/[orderId]", "page"); }
  catch { console.error("native_fulfillment_refresh_unavailable"); }
  return { status: "SAVED" };
}
