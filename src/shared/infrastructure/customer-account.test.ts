import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerLoginRequiredError } from "@/modules/customer/public";
const mocks = vi.hoisted(() => ({ config: vi.fn(), credential: vi.fn(), read: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("./config/customer-account-config", () => ({ loadCustomerAccountConfig: mocks.config }));
vi.mock("./security/customer-auth/service", () => ({ readCustomerCredential: mocks.credential }));
vi.mock("@/modules/customer/infrastructure/shopify-customer-account-reader", () => ({ ShopifyCustomerAccountReader: class { read = mocks.read; } }));
import { loadCustomerAccount } from "./customer-account";
afterEach(() => vi.resetAllMocks());
describe("customer account composition", () => {
  it("does not read cookies or customer data without configured authentication", async () => {
    mocks.config.mockReturnValue(null);
    expect(await loadCustomerAccount(undefined)).toEqual({ status: "disabled" });
    expect(mocks.headers).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("does not query orders for an unauthenticated customer", async () => {
    mocks.config.mockReturnValue({}); mocks.headers.mockResolvedValue(new Headers()); mocks.credential.mockResolvedValue(null);
    expect(await loadCustomerAccount(undefined)).toEqual({ status: "signed-out" }); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("requires verified credentials and maps provider expiry without returning data", async () => {
    mocks.config.mockReturnValue({}); mocks.headers.mockResolvedValue(new Headers()); mocks.credential.mockResolvedValue({ accessToken: "test-token" });
    mocks.read.mockRejectedValue(new CustomerLoginRequiredError());
    expect(await loadCustomerAccount(undefined)).toEqual({ status: "expired" });
  });
});
