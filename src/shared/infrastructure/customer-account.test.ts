import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerLoginRequiredError } from "@/modules/customer/public";
const mocks = vi.hoisted(() => ({ config: vi.fn(), credential: vi.fn(), read: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("./config/customer-account-config", () => ({ loadCustomerAccountConfig: mocks.config }));
vi.mock("./security/customer-auth/service", () => ({ readCustomerCredential: mocks.credential }));
vi.mock("./database/database-connections", () => ({ getApplicationDatabaseClient: vi.fn() }));
vi.mock("@/modules/order/infrastructure/postgres-customer-order-history", () => ({ PostgresCustomerOrderHistory: class { read = mocks.read; } }));
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
    mocks.config.mockReturnValue({}); mocks.headers.mockResolvedValue(new Headers()); mocks.credential.mockResolvedValue({ customerId: "00000000-0000-4000-8000-000000000001", name: "Native customer", email: "customer@example.test" });
    mocks.read.mockRejectedValue(new CustomerLoginRequiredError());
    expect(await loadCustomerAccount(undefined)).toEqual({ status: "expired" });
  });
  it("uses only the verified internal customer ID and keeps DB failure distinct from empty history", async () => {
    const customerId = "00000000-0000-4000-8000-000000000001";
    mocks.config.mockReturnValue({}); mocks.headers.mockResolvedValue(new Headers());
    mocks.credential.mockResolvedValue({ customerId, name: "Native customer", email: "customer@example.test" });
    mocks.read.mockResolvedValue({ orders: [], nextCursor: null });
    expect(await loadCustomerAccount(undefined)).toMatchObject({ status: "ready", account: { name: "Native customer", orders: [] } });
    expect(mocks.read).toHaveBeenCalledWith(customerId, null);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.read.mockRejectedValue(new Error("PRIVATE_DATABASE_DETAILS"));
    expect(await loadCustomerAccount(undefined)).toEqual({ status: "unavailable" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_DATABASE_DETAILS"); log.mockRestore();
  });
});
