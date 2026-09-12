import { describe, expect, it } from "vitest";
import { loadCustomerAccountConfig, InvalidCustomerAccountConfigurationError } from "./customer-account-config";
export const customerEnvironment = { CUSTOMER_ACCOUNT_ENABLED: "true", CUSTOMER_ACCOUNT_ORIGIN: "https://account.example.test",
  CUSTOMER_ACCOUNT_SECRET: "synthetic-customer-secret-".repeat(3), CUSTOMER_ACCOUNT_CLIENT_ID: "synthetic-client",
  CUSTOMER_ACCOUNT_CLIENT_SECRET: "synthetic-client-secret", CUSTOMER_ACCOUNT_SHOP_ID: "123456",
  SHOPIFY_STORE_DOMAIN: "synthetic-store.myshopify.com", AUTH_URL: "https://account.example.test" };
describe("customer account configuration", () => {
  it("is off by default and supports a separate secret on a matching app origin", () => {
    expect(loadCustomerAccountConfig({})).toBeNull();
    expect(loadCustomerAccountConfig({ ...customerEnvironment, CUSTOMER_ACCOUNT_ENABLED: "false" })).toBeNull();
    expect(loadCustomerAccountConfig({ ...customerEnvironment, AUTH_URL: "https://account.example.test/" })?.shopId).toBe("123456");
  });
  it.each([
    { CUSTOMER_ACCOUNT_ENABLED: "yes" }, { CUSTOMER_ACCOUNT_SECRET: "short" }, { CUSTOMER_ACCOUNT_CLIENT_SECRET: "" },
    { CUSTOMER_ACCOUNT_ORIGIN: "http://localhost:3000" }, { CUSTOMER_ACCOUNT_ORIGIN: "https://user:password@example.test" },
    { CUSTOMER_ACCOUNT_ORIGIN: "https://example.test/?redirect=other" }, { CUSTOMER_ACCOUNT_SHOP_ID: "../other" },
    { SHOPIFY_STORE_DOMAIN: "synthetic-store.myshopify.com.attacker.test" }, { AUTH_URL: "https://other.example.test" },
    { AUTH_URL: undefined }, { NEXTAUTH_URL: "https://other.example.test" }, { AUTH_REDIRECT_PROXY_URL: "https://other.example.test" },
  ])("rejects unsupported configuration without revealing it", (override) => {
    expect(() => loadCustomerAccountConfig({ ...customerEnvironment, ...override })).toThrow(InvalidCustomerAccountConfigurationError);
  });
});
