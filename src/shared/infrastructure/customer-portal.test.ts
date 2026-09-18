import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  config: vi.fn(),
  credential: vi.fn(),
  database: vi.fn(),
  change: vi.fn(),
  request: vi.fn(),
  read: vi.fn(),
  product: vi.fn(),
  agreement: vi.fn(),
  agree: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("./config/customer-account-config", () => ({
  loadCustomerAccountConfig: mocks.config,
}));
vi.mock("./security/customer-auth/service", () => ({
  readCustomerCredential: mocks.credential,
}));
vi.mock("./database/database-connections", () => ({
  getApplicationDatabaseClient: mocks.database,
}));
vi.mock("./config/data-protection-config", () => ({
  loadDataProtectionConfig: () => ({
    activeKeyId: "test",
    keys: new Map([["test", Buffer.alloc(32, 7)]]),
  }),
}));
vi.mock("./composition-root", () => ({
  application: { getProduct: { byId: mocks.product } },
}));
vi.mock("@/modules/customer/infrastructure/postgres-customer-portal", () => ({
  PostgresCustomerPortal: class {
    change = mocks.change;
    request = mocks.request;
    read = mocks.read;
    membershipAgreement = mocks.agreement;
    agreeToMembership = mocks.agree;
  },
}));
import {
  changeCustomerPortal,
  createCustomerRequest,
  customerPortalContext,
  loadCustomerPortal,
  loadMembershipAgreement,
  recordMembershipAgreement,
} from "./customer-portal";
import { storefrontContent } from "./content/storefront-content";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({ origin: "https://shop.example" });
  mocks.headers.mockResolvedValue(
    new Headers({ origin: "https://shop.example", cookie: "test" }),
  );
  mocks.credential.mockResolvedValue({
    customerId: "00000000-0000-4000-8000-000000000001",
    version: 2,
    expiresAt: Date.now() + 60000,
    email: "verified@example.test",
  });
});
function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [k, v] of Object.entries(values)) result.set(k, v);
  return result;
}
describe("customer portal transport trust boundaries", () => {
  it("rejects missing/foreign origins and unauthenticated calls before opening a database", async () => {
    for (const origin of ["", "https://evil.example"]) {
      mocks.headers.mockResolvedValue(new Headers(origin ? { origin } : {}));
      await expect(customerPortalContext(true)).rejects.toMatchObject({
        code: "expired",
      });
    }
    expect(mocks.database).not.toHaveBeenCalled();
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "https://shop.example" }),
    );
    mocks.credential.mockResolvedValue(null);
    await expect(customerPortalContext(true)).rejects.toMatchObject({
      code: "expired",
    });
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("uses the signed-in customer and verified email instead of posted identity", async () => {
    await changeCustomerPortal(
      form({
        kind: "marketing",
        revision: "0",
        enabled: "on",
        customerId: "forged",
        verifiedEmail: "forged@example.test",
      }),
    );
    expect(mocks.change).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "00000000-0000-4000-8000-000000000001",
      }),
      0,
      {
        kind: "marketing",
        enabled: true,
        verifiedEmail: "verified@example.test",
      },
    );
  });
  it("rejects bad fields and unknown products, and never permits client-originated roles", async () => {
    await expect(
      changeCustomerPortal(
        form({ kind: "profile", revision: "0", name: "", phone: "-------" }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      changeCustomerPortal(form({ kind: "grant-admin", revision: "0" })),
    ).rejects.toMatchObject({ code: "invalid" });
    mocks.product.mockResolvedValue(null);
    await expect(
      changeCustomerPortal(
        form({ kind: "favorite", revision: "0", productId: "unknown" }),
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it("validates request payload before write and preserves unavailable versus signed-out", async () => {
    await expect(
      createCustomerRequest(
        form({ id: "invalid", requestKind: "OTHER", message: "hello" }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.read.mockRejectedValue(Error("private database detail"));
    expect(await loadCustomerPortal()).toEqual({ status: "unavailable" });
    mocks.credential.mockResolvedValue(null);
    expect(await loadCustomerPortal()).toEqual({ status: "signed-out" });
  });
  it("records only an explicit agreement to the version that is still current, for the signed-in member", async () => {
    const version = storefrontContent.agreementVersion;
    await expect(recordMembershipAgreement(form({ version }))).rejects.toMatchObject({ code: "invalid" });
    await expect(recordMembershipAgreement(form({ agree: "on", version: "older-version" }))).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.agree).not.toHaveBeenCalled();
    await recordMembershipAgreement(form({ agree: "on", version, customerId: "forged" }));
    expect(mocks.agree).toHaveBeenCalledWith(expect.objectContaining({ customerId: "00000000-0000-4000-8000-000000000001" }), version);
    mocks.headers.mockResolvedValue(new Headers({ origin: "https://evil.example", cookie: "test" }));
    await expect(recordMembershipAgreement(form({ agree: "on", version }))).rejects.toMatchObject({ code: "expired" });
  });
  it("compares the latest record with the current version and keeps unavailable distinct from signed-out", async () => {
    mocks.agreement.mockResolvedValue(null);
    expect(await loadMembershipAgreement()).toEqual({ status: "ready", agreement: { status: "required", version: storefrontContent.agreementVersion, previousVersion: null } });
    mocks.agreement.mockResolvedValue({ status: "GRANTED", version: storefrontContent.agreementVersion });
    expect(await loadMembershipAgreement()).toEqual({ status: "ready", agreement: { status: "agreed", version: storefrontContent.agreementVersion } });
    mocks.agreement.mockRejectedValue(Error("private database detail"));
    expect(await loadMembershipAgreement()).toEqual({ status: "unavailable" });
    mocks.credential.mockResolvedValue(null);
    expect(await loadMembershipAgreement()).toEqual({ status: "signed-out" });
  });
});
