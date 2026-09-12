import { z } from "zod";
import { CustomerAccountUnavailableError, CustomerLoginRequiredError, type CustomerAccountReader } from "../domain/customer-account";
import type { CustomerAccountConfig } from "@/shared/infrastructure/config/customer-account-config";
import { createCustomerFetch, customerEndpoints } from "@/shared/infrastructure/security/customer-auth/provider";

const yen = z.string().regex(/^(0|[1-9][0-9]*)(\.0+)?$/).transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const cursor = z.string().regex(/^[A-Za-z0-9_+/=-]{1,2048}$/);
const schema = z.object({ data: z.object({ customer: z.object({
  displayName: z.string().max(512), emailAddress: z.object({ emailAddress: z.email() }).nullable(),
  orders: z.object({ nodes: z.array(z.object({
    id: z.string().regex(/^gid:\/\/shopify\/Order\/[0-9]+$/), name: z.string().min(1).max(100),
    processedAt: z.iso.datetime({ offset: true }), cancelledAt: z.iso.datetime({ offset: true }).nullable(),
    totalPrice: z.object({ amount: yen, currencyCode: z.literal("JPY") }),
    financialStatus: z.string().max(100).nullable(), fulfillmentStatus: z.string().max(100),
  })).max(10), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: cursor.nullable() }) }),
}) }), errors: z.array(z.unknown()).max(0).optional() });
const query = `query BloomBoxCustomerAccount($after: String) {
  customer {
    displayName emailAddress { emailAddress }
    orders(first: 10, after: $after, sortKey: PROCESSED_AT, reverse: true) {
      nodes { id name processedAt cancelledAt financialStatus fulfillmentStatus totalPrice { amount currencyCode } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
/** Bound to the server-verified customer's access token; never uses Admin/Storefront credentials. */
export class ShopifyCustomerAccountReader implements CustomerAccountReader {
  constructor(private readonly config: CustomerAccountConfig, private readonly accessToken: string,
    private readonly transport: typeof fetch = fetch) {}
  async read(after: string | null) {
    try {
      if (after !== null) cursor.parse(after);
      const endpoints = customerEndpoints(this.config);
      const request = createCustomerFetch(this.config, this.transport);
      const discovery = await request(endpoints.apiDiscovery);
      if (!discovery.ok) throw new CustomerAccountUnavailableError();
      z.object({ graphql_api: z.literal(endpoints.graphql) }).parse(await discovery.json());
      const response = await request(endpoints.graphql, { method: "POST", headers: {
        "Content-Type": "application/json", Authorization: this.accessToken,
      }, body: JSON.stringify({ query, variables: { after } }) });
      if (response.status === 401) throw new CustomerLoginRequiredError();
      if (!response.ok) throw new CustomerAccountUnavailableError();
      const customer = schema.parse(await response.json()).data.customer;
      if (customer.orders.pageInfo.hasNextPage && (!customer.orders.pageInfo.endCursor
        || customer.orders.pageInfo.endCursor === after || customer.orders.nodes.length === 0)) throw new CustomerAccountUnavailableError();
      if (new Set(customer.orders.nodes.map((order) => order.id)).size !== customer.orders.nodes.length) throw new CustomerAccountUnavailableError();
      return { name: customer.displayName, email: customer.emailAddress?.emailAddress ?? null,
        orders: customer.orders.nodes.map((order) => ({ id: order.id, name: order.name,
          orderedAt: order.processedAt, totalYen: order.totalPrice.amount, payment: order.financialStatus ?? "UNKNOWN",
          fulfillment: order.fulfillmentStatus, cancelled: order.cancelledAt !== null })),
        nextCursor: customer.orders.pageInfo.hasNextPage ? customer.orders.pageInfo.endCursor : null };
    } catch (error) {
      if (error instanceof CustomerLoginRequiredError) throw error;
      // Never propagate a provider payload, token, or customer data into logs/errors.
      throw new CustomerAccountUnavailableError();
    }
  }
}
