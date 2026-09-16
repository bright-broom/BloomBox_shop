import { z } from "zod";
import { CustomerManagementError } from "@/modules/customer/public";
import { OPERATOR_ORDER_SEARCH_LIMIT } from "@/modules/order/public";
import { PostgresOperatorOrders } from "@/modules/order/infrastructure/postgres-operator-orders";
import { getCustomerSupportDatabaseClient } from "../../database/database-connections";
import { getOperatorAuth } from "./operator-auth";
import { GoogleFulfillmentOperatorIdentity } from "./google-operator-identity";
import { withCustomerSupport } from "./customer-management-transaction";
export const operatorOrderInput = z
  .object({
    q: z
      .string()
      .trim()
      .max(OPERATOR_ORDER_SEARCH_LIMIT)
      .regex(/^[A-Za-z0-9_-]*$/)
      .optional(),
    after: z.uuid().optional(),
    status: z
      .enum(["", "PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"])
      .optional(),
    payment: z
      .enum([
        "",
        "PENDING",
        "AUTHORIZED",
        "CAPTURED",
        "PARTIALLY_REFUNDED",
        "REFUNDED",
        "FAILED",
        "CANCELLED",
        "DISPUTED",
      ])
      .optional(),
    fulfillment: z
      .enum([
        "",
        "UNFULFILLED",
        "PROCESSING",
        "READY",
        "ON_HOLD",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
        "RETURNED",
      ])
      .optional(),
  })
  .strict();
export const operatorReportInput = z
  .object({ days: z.enum(["7", "30", "90"]).default("30") })
  .strict();
async function context() {
  const auth = getOperatorAuth();
  if (!auth) throw new CustomerManagementError("DENIED");
  const actor = await new GoogleFulfillmentOperatorIdentity(
    () => auth.auth.auth(),
    auth.config.bindings,
  ).current();
  if (!actor) throw new CustomerManagementError("DENIED");
  return { actor, sql: getCustomerSupportDatabaseClient() };
}
export async function openOperatorOrders(input: unknown) {
  const { actor, sql } = await context();
  const parsed = operatorOrderInput.safeParse(input);
  if (!parsed.success) throw new CustomerManagementError("INVALID");
  return withCustomerSupport(sql, actor, "HISTORY", async (tx) => {
    const value = await new PostgresOperatorOrders(tx).list(parsed.data);
    return {
      value,
      customerIds: [
        ...new Set(
          value.orders.flatMap((o) => (o.customerId ? [o.customerId] : [])),
        ),
      ],
    };
  });
}
export async function openOperatorReport(input: unknown) {
  const { actor, sql } = await context();
  const parsed = operatorReportInput.safeParse(input);
  if (!parsed.success) throw new CustomerManagementError("INVALID");
  return withCustomerSupport(sql, actor, "HISTORY", async (tx) => ({
    value: await new PostgresOperatorOrders(tx).report(
      Number(parsed.data.days),
    ),
    customerIds: [],
  }));
}
