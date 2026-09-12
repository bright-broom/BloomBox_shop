import { describe, expect, it } from "vitest";
import { loadCustomerAccountConfig, InvalidCustomerAccountConfigurationError } from "./customer-account-config";
export const customerEnvironment = { CUSTOMER_ACCOUNT_ENABLED: "true", CUSTOMER_ACCOUNT_ORIGIN: "https://account.example.test",
  CUSTOMER_ACCOUNT_SECRET: "synthetic-customer-secret-".repeat(3), CUSTOMER_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
  CUSTOMER_GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
  AUTH_URL: "https://account.example.test" };
describe("customer account configuration", () => {
  it("is off by default and supports a separate secret on a matching app origin", () => {
    expect(loadCustomerAccountConfig({})).toBeNull();
    expect(loadCustomerAccountConfig({ ...customerEnvironment, CUSTOMER_ACCOUNT_ENABLED: "false" })).toBeNull();
    expect(loadCustomerAccountConfig({ ...customerEnvironment, AUTH_URL: "https://account.example.test/" })?.clientId).toBe("synthetic.apps.googleusercontent.com");
  });
  it("allows local Google callbacks only outside production and rejects old Shopify-only configuration", () => {
    const local = { ...customerEnvironment, AUTH_URL: "http://localhost:3004", CUSTOMER_ACCOUNT_ORIGIN: "http://localhost:3004" };
    expect(loadCustomerAccountConfig(local)?.origin).toBe(local.AUTH_URL);
    expect(() => loadCustomerAccountConfig({ ...local, BLOOMBOX_RUNTIME_MODE: "production" })).toThrow(InvalidCustomerAccountConfigurationError);
    expect(() => loadCustomerAccountConfig({ ...customerEnvironment, CUSTOMER_GOOGLE_CLIENT_ID: undefined,
      CUSTOMER_ACCOUNT_CLIENT_ID: "old-shopify-client" })).toThrow(InvalidCustomerAccountConfigurationError);
  });
  it.each([
    { CUSTOMER_ACCOUNT_ENABLED: "yes" }, { CUSTOMER_ACCOUNT_SECRET: "short" }, { CUSTOMER_GOOGLE_CLIENT_SECRET: "" },
    { CUSTOMER_ACCOUNT_ORIGIN: "http://example.test" }, { CUSTOMER_ACCOUNT_ORIGIN: "https://user:password@example.test" },
    { CUSTOMER_ACCOUNT_ORIGIN: "https://example.test/?redirect=other" }, { CUSTOMER_GOOGLE_CLIENT_ID: "../other" },
    { AUTH_GOOGLE_ID: "synthetic.apps.googleusercontent.com" }, { AUTH_SECRET: customerEnvironment.CUSTOMER_ACCOUNT_SECRET }, { AUTH_URL: "https://other.example.test" },
    { AUTH_URL: undefined }, { NEXTAUTH_URL: "https://other.example.test" }, { AUTH_REDIRECT_PROXY_URL: "https://other.example.test" },
  ])("rejects unsupported configuration without revealing it", (override) => {
    expect(() => loadCustomerAccountConfig({ ...customerEnvironment, ...override })).toThrow(InvalidCustomerAccountConfigurationError);
  });
});
