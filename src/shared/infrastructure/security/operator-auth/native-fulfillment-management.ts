import { z } from "zod";
import { ApplyNativeFulfillmentCommand, NativeFulfillmentError, nativeFulfillmentCommandSchema, nativeFulfillmentListSchema, type NativeFulfillmentListQuery } from "@/modules/fulfillment/public";
import { PostgresNativeFulfillmentStore } from "@/modules/fulfillment/infrastructure/postgres-native-fulfillment-store";
import { getNativeFulfillmentDatabaseClient } from "../../database/database-connections";
import { loadDataProtectionConfig } from "../../config/data-protection-config";
import { AesGcmDataProtector } from "../aes-gcm-data-protector";
import { GoogleFulfillmentOperatorIdentity } from "./google-operator-identity";
import { getOperatorAuth } from "./operator-auth";
import { withNativeFulfillmentOperator } from "./native-fulfillment-transaction";
async function context(origin?: string | null) {
  const auth = getOperatorAuth();
  if (!auth || (origin !== undefined && origin !== auth.config.origin)) throw new NativeFulfillmentError("DENIED");
  const actor = await new GoogleFulfillmentOperatorIdentity(() => auth.auth.auth(), auth.config.bindings).current();
  if (!actor) throw new NativeFulfillmentError("DENIED");
  return { actor, sql: getNativeFulfillmentDatabaseClient() };
}
function protector() { return new AesGcmDataProtector(loadDataProtectionConfig()); }
export async function readNativeFulfillments(input: NativeFulfillmentListQuery) {
  const { actor, sql } = await context();
  const parsed = nativeFulfillmentListSchema.safeParse(input);
  if (!parsed.success) throw new NativeFulfillmentError("INVALID");
  return withNativeFulfillmentOperator(sql, actor, (tx) => new PostgresNativeFulfillmentStore(tx, protector()).list(parsed.data));
}
export async function readNativeFulfillment(id: string) {
  const { actor, sql } = await context();
  if (!z.uuid().safeParse(id).success) throw new NativeFulfillmentError("INVALID");
  return withNativeFulfillmentOperator(sql, actor, (tx) => new PostgresNativeFulfillmentStore(tx, protector()).read(id, actor));
}
export async function changeNativeFulfillment(form: FormData, origin: string | null) {
  const { actor, sql } = await context(origin);
  const entries = [...form.entries()].filter(([key]) => !key.startsWith("$ACTION_"));
  if (entries.some(([, value]) => typeof value !== "string") || new Set(entries.map(([key]) => key)).size !== entries.length) throw new NativeFulfillmentError("INVALID");
  const values = Object.fromEntries(entries);
  const parsed = nativeFulfillmentCommandSchema.safeParse({ ...values, expectedVersion: typeof values.expectedVersion === "string" && /^\d+$/.test(values.expectedVersion) ? Number(values.expectedVersion) : NaN });
  if (!parsed.success) throw new NativeFulfillmentError("INVALID");
  return withNativeFulfillmentOperator(sql, actor, (tx) => new ApplyNativeFulfillmentCommand(new PostgresNativeFulfillmentStore(tx, protector())).execute(parsed.data, actor));
}
