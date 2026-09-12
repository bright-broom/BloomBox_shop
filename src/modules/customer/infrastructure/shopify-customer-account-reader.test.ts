import { describe, expect, it, vi } from "vitest";
import { ShopifyCustomerAccountReader } from "./shopify-customer-account-reader";
import { CustomerAccountUnavailableError, CustomerLoginRequiredError, readCustomerAccount } from "../public";
import { loadCustomerAccountConfig } from "@/shared/infrastructure/config/customer-account-config";
const customerEnvironment = { CUSTOMER_ACCOUNT_ENABLED: "true", CUSTOMER_ACCOUNT_ORIGIN: "https://account.example.test",
  CUSTOMER_ACCOUNT_SECRET: "synthetic-customer-secret-".repeat(3), CUSTOMER_ACCOUNT_CLIENT_ID: "synthetic-client",
  CUSTOMER_ACCOUNT_CLIENT_SECRET: "synthetic-client-secret", CUSTOMER_ACCOUNT_SHOP_ID: "123456", SHOPIFY_STORE_DOMAIN: "synthetic-store.myshopify.com", AUTH_URL: "https://account.example.test" };
import { customerEndpoints, createCustomerFetch } from "@/shared/infrastructure/security/customer-auth/provider";
const config = loadCustomerAccountConfig(customerEnvironment)!;
const endpoints = customerEndpoints(config);
const order = { id: "gid://shopify/Order/100", name: "#100", processedAt: "2026-09-10T10:00:00Z", cancelledAt: null,
  totalPrice: { amount: "5000.00", currencyCode: "JPY" }, financialStatus: "PAID", fulfillmentStatus: "UNFULFILLED" };
const payload = (nodes = [order], hasNextPage = false, endCursor: string | null = null) => ({ data: { customer: {
  displayName: "Synthetic customer", emailAddress: { emailAddress: "sample@example.test" }, orders: { nodes, pageInfo: { hasNextPage, endCursor } },
} } });
function setup(value: unknown = payload(), status = 200) {
  const transport = vi.fn<typeof fetch>(async (input) => String(input) === endpoints.apiDiscovery
    ? Response.json({ graphql_api: endpoints.graphql }) : Response.json(value, { status }));
  return { transport, reader: new ShopifyCustomerAccountReader(config, "synthetic-token", transport) };
}
describe("native customer account reads", () => {
  it("reads only the token's customer with bounded pagination, integer JPY, and no recipient fields", async () => {
    const { reader, transport } = setup(payload([order], true, "next-cursor"));
    expect(await readCustomerAccount(reader, "current-cursor")).toMatchObject({ name: "Synthetic customer",
      orders: [{ totalYen: 5000, payment: "PAID", cancelled: false }], nextCursor: "next-cursor" });
    const [url, init] = transport.mock.calls[1];
    expect(url).toBe(endpoints.graphql);
    expect(init).toMatchObject({ cache: "no-store", redirect: "error", headers: { Authorization: "synthetic-token" } });
    const request = JSON.parse(String(init?.body));
    expect(request.variables).toEqual({ after: "current-cursor" });
    expect(request.query).not.toMatch(/customerId|shippingAddress|phone|statusPageUrl|note|mutation/);
  });
  it("keeps different customer tokens request-scoped", async () => {
    const transport = vi.fn<typeof fetch>(async (input, init) => String(input) === endpoints.apiDiscovery
      ? Response.json({ graphql_api: endpoints.graphql }) : Response.json({ data: { customer: { ...payload().data.customer,
        displayName: new Headers(init?.headers).get("Authorization") === "buyer-a" ? "Buyer A" : "Buyer B" } } }));
    const a = new ShopifyCustomerAccountReader(config, "buyer-a", transport);
    const b = new ShopifyCustomerAccountReader(config, "buyer-b", transport);
    expect((await a.read(null)).name).toBe("Buyer A"); expect((await b.read(null)).name).toBe("Buyer B");
    expect((await a.read(null)).name).toBe("Buyer A");
  });
  it("distinguishes an actual empty account from failure", async () => {
    expect((await setup(payload([])).reader.read(null)).orders).toEqual([]);
    await expect(setup({ errors: [{ message: "private provider data" }] }).reader.read(null)).rejects.toThrow(CustomerAccountUnavailableError);
    await expect(setup({ ...payload(), errors: [{}] }).reader.read(null)).rejects.toThrow(CustomerAccountUnavailableError);
  });
  it.each([401])("requires login after provider rejection %s", async (status) => {
    await expect(setup({}, status).reader.read(null)).rejects.toThrow(CustomerLoginRequiredError);
  });
  it.each([403, 429, 500, 503])("keeps a provider outage %s distinct from an empty history", async (status) => {
    await expect(setup({}, status).reader.read(null)).rejects.toThrow(CustomerAccountUnavailableError);
  });
  it.each(["1.5", "-1", "9007199254740992", "Infinity"])("rejects invalid yen %s", async (amount) => {
    await expect(setup(payload([{ ...order, totalPrice: { amount, currencyCode: "JPY" } }])).reader.read(null)).rejects.toThrow(CustomerAccountUnavailableError);
  });
  it("rejects another currency, duplicate orders, and broken/repeated page cursors", async () => {
    for (const value of [payload([{ ...order, totalPrice: { amount: "1", currencyCode: "USD" } }]),
      payload([order, order]), payload([order], true, null), payload([order], true, "same"), payload([], true, "next")]) {
      await expect(setup(value).reader.read("same")).rejects.toThrow(CustomerAccountUnavailableError);
    }
  });
  it.each([[], ["cursor"], "", "cursor\n", "x".repeat(2049), { customerId: "someone-else" }])("rejects invalid page input before I/O: %j", async (input) => {
    const { reader, transport } = setup();
    await expect(readCustomerAccount(reader, input)).rejects.toThrow(CustomerAccountUnavailableError);
    expect(transport).not.toHaveBeenCalled();
  });
  it("never sends a credential to redirected or mismatched discovery destinations", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ graphql_api: endpoints.graphql.replace("123456", "999999") }));
    await expect(new ShopifyCustomerAccountReader(config, "private-token", transport).read(null)).rejects.toThrow(CustomerAccountUnavailableError);
    expect(transport).toHaveBeenCalledTimes(1);
    const guarded = createCustomerFetch(config, transport);
    await expect(guarded("https://attacker.test/api")).rejects.toThrow("destination rejected");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("bounds the response even without a content-length header", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response("x".repeat(256 * 1024 + 1)));
    await expect(new ShopifyCustomerAccountReader(config, "token", transport).read(null)).rejects.toThrow(CustomerAccountUnavailableError);
  });
});
