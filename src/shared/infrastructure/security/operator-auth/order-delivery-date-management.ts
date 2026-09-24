import { z } from "zod";
import {
  ChangeOrderDeliveryDate,
  ORDER_DELIVERY_DATE_HISTORY_LIMIT,
  ORDER_DELIVERY_DATE_REASON_MAX_LENGTH,
  OrderDeliveryDateChangeError,
} from "@/modules/order/public";
import { PostgresOrderDeliveryDateStore } from "@/modules/order/infrastructure/postgres-order-delivery-date";
import { getEarliestDeliveryDate, getLatestDeliveryDate } from "@/modules/fulfillment/public";
import { getNativeFulfillmentDatabaseClient } from "../../database/database-connections";
import { GoogleFulfillmentOperatorIdentity } from "./google-operator-identity";
import { getOperatorAuth } from "./operator-auth";
import { withOperatorGrant } from "./native-fulfillment-transaction";

/** The delivery date is the order's, so every outcome — including a refused grant — speaks in its codes. */
const grant = {
  reject: (code: "DENIED" | "CONFLICT" | "UNAVAILABLE") => new OrderDeliveryDateChangeError(code),
  expected: (error: unknown) => error instanceof OrderDeliveryDateChangeError,
};

const commandSchema = z.object({
  orderId: z.uuid(), requestId: z.uuid(),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1).max(ORDER_DELIVERY_DATE_REASON_MAX_LENGTH),
}).strict();

/** The operator authority is the same one that records preparation and shipping (ADR 0015). */
async function context(origin?: string | null) {
  const auth = getOperatorAuth();
  if (!auth || (origin !== undefined && origin !== auth.config.origin)) throw new OrderDeliveryDateChangeError("DENIED");
  const actor = await new GoogleFulfillmentOperatorIdentity(() => auth.auth.auth(), auth.config.bindings).current();
  if (!actor) throw new OrderDeliveryDateChangeError("DENIED");
  return { actor, sql: getNativeFulfillmentDatabaseClient() };
}

/** The orderable range is recomputed here, so an operator cannot post a date the shop could not accept today. */
export function orderDeliveryDateWindow(now: Date = new Date()) {
  return { earliest: getEarliestDeliveryDate(now), latest: getLatestDeliveryDate(now) };
}

export async function changeOrderDeliveryDate(form: FormData, origin: string | null) {
  const { actor, sql } = await context(origin);
  const entries = [...form.entries()].filter(([key]) => !key.startsWith("$ACTION_"));
  if (entries.some(([, value]) => typeof value !== "string") || new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new OrderDeliveryDateChangeError("INVALID");
  }
  const parsed = commandSchema.safeParse(Object.fromEntries(entries));
  if (!parsed.success) throw new OrderDeliveryDateChangeError("INVALID");
  return withOperatorGrant(sql, actor, (tx) =>
    new ChangeOrderDeliveryDate(new PostgresOrderDeliveryDateStore(tx)).execute(parsed.data, orderDeliveryDateWindow(), actor), grant);
}

export async function readOrderDeliveryDateHistory(orderId: string) {
  const { actor, sql } = await context();
  if (!z.uuid().safeParse(orderId).success) throw new OrderDeliveryDateChangeError("INVALID");
  return withOperatorGrant(sql, actor, (tx) =>
    new PostgresOrderDeliveryDateStore(tx).history(orderId, ORDER_DELIVERY_DATE_HISTORY_LIMIT), grant);
}
