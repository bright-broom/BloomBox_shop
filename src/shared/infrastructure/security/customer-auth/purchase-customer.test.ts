import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn(), credential: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("../../config/customer-account-config", () => ({ loadCustomerAccountConfig: mocks.config }));
vi.mock("./service", () => ({ readCustomerCredential: mocks.credential }));
import { readCurrentPurchaseCustomer } from "./purchase-customer";

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "production");
  mocks.config.mockReturnValue({});
  mocks.headers.mockResolvedValue(new Headers({ cookie: "customer-cookie", "x-customer-id": "forged" }));
});
afterEach(() => vi.unstubAllEnvs());
describe("purchase identity boundary", () => {
  it("selects only the ID and version verified from the customer cookie", async () => {
    mocks.credential.mockResolvedValue({ customerId: "verified-id", version: 2, email: "private@example.test", subject: "private-google-id", name: "private-name" });
    expect(await readCurrentPurchaseCustomer()).toEqual({ customerId: "verified-id", version: 2 });
    expect(mocks.credential).toHaveBeenCalledWith("customer-cookie", {});
  });
  it("keeps missing/expired login anonymous but propagates verification outages", async () => {
    mocks.credential.mockResolvedValue(null);
    expect(await readCurrentPurchaseCustomer()).toBeNull();
    mocks.credential.mockRejectedValue(new Error("Verification unavailable"));
    await expect(readCurrentPurchaseCustomer()).rejects.toThrow("Verification unavailable");
  });
  it("never reads durable identity for Preview or disabled customer login", async () => {
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "preview");
    expect(await readCurrentPurchaseCustomer()).toBeNull();
    expect(mocks.config).not.toHaveBeenCalled();
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "production"); mocks.config.mockReturnValue(null);
    expect(await readCurrentPurchaseCustomer()).toBeNull();
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.credential).not.toHaveBeenCalled();
  });
});
