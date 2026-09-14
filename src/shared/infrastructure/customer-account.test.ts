import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerLoginRequiredError } from "@/modules/customer/public";
const mocks = vi.hoisted(() => ({ config: vi.fn(), credential: vi.fn(), read: vi.fn(), detail: vi.fn(), spend: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("./config/customer-account-config", () => ({ loadCustomerAccountConfig: mocks.config }));
vi.mock("./security/customer-auth/service", () => ({ readCustomerCredential: mocks.credential }));
vi.mock("./database/database-connections", () => ({ getApplicationDatabaseClient: vi.fn() }));
vi.mock("@/modules/order/infrastructure/postgres-customer-order-history", () => ({ PostgresCustomerOrderHistory: class { read = mocks.read; readDetail = mocks.detail; } }));
vi.mock("@/modules/order/infrastructure/postgres-customer-purchase-performance", () => ({ PostgresCustomerPurchasePerformance: class { readEligibleSpend = mocks.spend; } }));
import { loadCustomerAccount, loadCustomerOrderDetail } from "./customer-account";
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
    mocks.spend.mockResolvedValue(12000);
    expect(await loadCustomerAccount(undefined)).toMatchObject({ status: "ready", account: { name: "Native customer", orders: [] } });
    expect(mocks.read).toHaveBeenCalledWith(customerId, null);
    expect(mocks.spend).toHaveBeenCalledWith(customerId);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.spend.mockRejectedValue(new Error("PRIVATE_PERFORMANCE"));
    expect(await loadCustomerAccount(undefined)).toMatchObject({ status: "ready", account: { orders: [] }, loyalty: { status: "unavailable" } });
    mocks.read.mockRejectedValue(new Error("PRIVATE_DATABASE_DETAILS"));
    expect(await loadCustomerAccount(undefined)).toEqual({ status: "unavailable" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_DATABASE_DETAILS"); log.mockRestore();
  });
});
describe("customer order detail composition", () => {
  it("never reads an order with disabled auth or absent/revoked credentials", async () => {
    mocks.config.mockReturnValue(null);
    expect(await loadCustomerOrderDetail("order")).toEqual({ status: "disabled" });
    expect(mocks.credential).not.toHaveBeenCalled();
    mocks.config.mockReturnValue({}); mocks.headers.mockResolvedValue(new Headers()); mocks.credential.mockResolvedValue(null);
    expect(await loadCustomerOrderDetail("order")).toEqual({ status: "signed-out" });
    expect(mocks.detail).not.toHaveBeenCalled();
  });
  it("uses only the verified owner and returns the same not-found state for inaccessible orders", async () => {
    mocks.config.mockReturnValue({}); mocks.headers.mockResolvedValue(new Headers());
    mocks.credential.mockResolvedValue({ customerId: "verified-owner" });
    mocks.detail.mockResolvedValue(null);
    expect(await loadCustomerOrderDetail("requested-order")).toEqual({ status: "not-found" });
    expect(mocks.detail).toHaveBeenCalledWith("verified-owner", "requested-order");
    const order = { id: "requested-order" }; mocks.detail.mockResolvedValue(order);
    expect(await loadCustomerOrderDetail("requested-order")).toEqual({ status: "ready", order });
  });
  it("keeps authentication/database failure separate from missing orders without exposing diagnostics", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.config.mockReturnValue({}); mocks.headers.mockResolvedValue(new Headers());
    mocks.credential.mockRejectedValue(new Error("PRIVATE_AUTH_DETAILS"));
    expect(await loadCustomerOrderDetail("order")).toEqual({ status: "unavailable" });
    expect(mocks.detail).not.toHaveBeenCalled();
    mocks.credential.mockResolvedValue({ customerId: "verified-owner" });
    mocks.detail.mockRejectedValue(new Error("PRIVATE_DB_DETAILS"));
    expect(await loadCustomerOrderDetail("order")).toEqual({ status: "unavailable" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE"); log.mockRestore();
  });
});
